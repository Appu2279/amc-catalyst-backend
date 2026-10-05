import { Op, QueryTypes } from 'sequelize';
import {
  sequelize, LiveExam, MockTest, MockTestQuestion, Question, QuestionOption, Subject,
  UserMockAttempt, AttemptQuestion, UserAnswer,
} from '../models/index.js';
import { NAME_DISPLAY_MODES } from '../models/liveExam.model.js';
import { AppError } from '../utils/AppError.js';
import { EXAM_DOMAINS } from '../constants/examDomains.js';
import { gradeAttempt } from './attempt.service.js';
import { createWeightedMock } from './weightedMock.service.js';

// An answer that left the browser just before the deadline is still accepted
// if it arrives within this many seconds of it.
const ANSWER_GRACE_SECONDS = 30;
// A student cannot start with less than this left before the exam closes.
const MIN_START_SECONDS = 60;
const MAX_LEADERBOARD = 500;

const DOMAIN_LABELS = new Map(EXAM_DOMAINS.map((d) => [d.key, d.label]));
const domainLabel = (key) => DOMAIN_LABELS.get(key) ?? 'Other';

// ── Schedule ─────────────────────────────────────────────────────────────────

/**
 * Where an exam is in its life: 'upcoming' → 'open' → 'closed' → 'results'.
 * Derived from the dates and the publish stamp, never stored, so editing a
 * date is all it takes to open or close an exam early.
 */
export const getPhase = (exam, now = new Date()) => {
  if (exam.results_published_at) return 'results';
  if (now < exam.opens_at) return 'upcoming';
  if (now < exam.closes_at) return 'open';
  return 'closed';
};

/** When an attempt must end: its full duration, but never past closing time. */
const getDeadline = (exam, attempt, durationMinutes) =>
  new Date(Math.min(
    new Date(attempt.started_at).getTime() + durationMinutes * 60_000,
    new Date(exam.closes_at).getTime(),
  ));

const loadExam = async (id, { transaction } = {}) => {
  const exam = await LiveExam.findByPk(id, {
    include: [{ model: MockTest, as: 'mock_test' }],
    transaction,
  });
  if (!exam) throw new AppError('Live exam not found', 404);
  return exam;
};

/**
 * Grades every in-progress attempt whose deadline has passed — students who
 * closed the tab, lost connection or never pressed Submit. Each is closed at
 * its deadline, with whatever answers were saved by then.
 *
 * Run lazily wherever an attempt's state matters (the student's own page, the
 * admin results, publishing), so there is no background job to keep alive.
 */
const finalizeExpired = async (exam, { userId } = {}) => {
  const now = new Date();
  const open = await UserMockAttempt.findAll({
    where: {
      mock_test_id: exam.mock_test_id,
      status: 'in_progress',
      ...(userId ? { user_id: userId } : {}),
    },
  });

  let finalized = 0;
  for (const attempt of open) {
    const deadline = getDeadline(exam, attempt, exam.mock_test.duration_minutes);
    if (deadline > now) continue;
    await sequelize.transaction((t) => gradeAttempt(attempt, { transaction: t, completedAt: deadline }));
    finalized++;
  }
  if (finalized) invalidateResultsCache(exam.id);
  return finalized;
};

// ── Results computation ──────────────────────────────────────────────────────

const percentOf = (score, totalMarks) =>
  totalMarks > 0 ? Math.round((score / totalMarks) * 1000) / 10 : 0;

/**
 * Every attempt at this exam with its counts, plus a competition rank
 * (1, 2, 2, 4 …) by score among completed ones. Admin attempts are test runs:
 * left out unless `includeAdmins`, and never ranked even then.
 */
const loadStandings = async (exam, { includeAdmins = false } = {}) => {
  const rows = await sequelize.query(
    `SELECT a.id AS attempt_id, a.user_id, u.full_name, u.email, u.country, (u.role = 'admin') AS is_admin,
            a.status, a.score, a.total_correct, a.total_wrong, a.total_unanswered,
            a.started_at, a.completed_at, a.time_taken_seconds,
            (SELECT COUNT(*)::int FROM attempt_questions aq WHERE aq.attempt_id = a.id) AS question_count,
            (SELECT COUNT(*)::int FROM user_answers ua
              WHERE ua.attempt_id = a.id AND ua.selected_option_id IS NOT NULL) AS answered_count
       FROM user_mock_attempts a
       JOIN users u ON u.id = a.user_id
      WHERE a.mock_test_id = :mockTestId
        ${includeAdmins ? '' : "AND u.role <> 'admin'"}
      ORDER BY u.role = 'admin', (a.status = 'completed') DESC, a.score DESC, a.time_taken_seconds ASC, a.id ASC`,
    { replacements: { mockTestId: exam.mock_test_id }, type: QueryTypes.SELECT }
  );

  const totalMarks = exam.mock_test.total_marks || exam.mock_test.total_questions;
  let rank = 0, previousScore = null, position = 0;
  for (const row of rows) {
    row.percent = percentOf(row.score, totalMarks);
    row.passed = exam.pass_percent == null || row.status !== 'completed' ? null : row.percent >= exam.pass_percent;
    if (row.status !== 'completed' || row.is_admin) { row.rank = null; continue; }
    position++;
    if (row.score !== previousScore) { rank = position; previousScore = row.score; }
    row.rank = rank;
  }
  return rows;
};

/** Per completed attempt and AMC domain: how many questions, right and wrong. */
const loadDomainBreakdown = (exam, attemptId = null) =>
  sequelize.query(
    `SELECT aq.attempt_id, COALESCE(s.exam_domain, 'other') AS domain,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ua.is_correct = true)::int AS correct,
            COUNT(*) FILTER (WHERE ua.is_correct = false)::int AS wrong
       FROM attempt_questions aq
       JOIN user_mock_attempts a ON a.id = aq.attempt_id
       JOIN users u ON u.id = a.user_id
       JOIN questions q ON q.id = aq.question_id
       LEFT JOIN subjects s ON s.id = q.subject_id
       LEFT JOIN user_answers ua ON ua.attempt_id = aq.attempt_id AND ua.question_id = aq.question_id
      WHERE a.mock_test_id = :mockTestId
        AND a.status = 'completed'
        AND u.role <> 'admin'
        ${attemptId ? 'AND a.id = :attemptId' : ''}
      GROUP BY aq.attempt_id, COALESCE(s.exam_domain, 'other')`,
    { replacements: { mockTestId: exam.mock_test_id, attemptId }, type: QueryTypes.SELECT }
  );

/** Domains in blueprint order, with each one's average % correct across candidates. */
const summarizeDomains = (breakdown) => {
  const byDomain = Map.groupBy(breakdown, (r) => r.domain);
  const keys = [...EXAM_DOMAINS.map((d) => d.key), 'other'].filter((k) => byDomain.has(k));
  return keys.map((key) => {
    const rows = byDomain.get(key);
    const total = rows.reduce((sum, r) => sum + r.total, 0);
    const correct = rows.reduce((sum, r) => sum + r.correct, 0);
    return {
      key,
      label: domainLabel(key),
      questions: rows[0].total,
      average_percent: total ? Math.round((correct / total) * 1000) / 10 : 0,
    };
  });
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const buildStats = (exam, completed) => {
  const percents = completed.map((r) => r.percent);
  const distribution = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: (i + 1) * 10, count: 0 }));
  for (const p of percents) distribution[Math.min(9, Math.floor(p / 10))].count++;
  const passCount = exam.pass_percent == null ? null : completed.filter((r) => r.passed).length;
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    candidates: completed.length,
    average_score: completed.length ? round1(completed.reduce((s, r) => s + r.score, 0) / completed.length) : 0,
    average_percent: percents.length ? round1(percents.reduce((a, b) => a + b, 0) / percents.length) : 0,
    median_percent: round1(median(percents)),
    highest_score: completed.length ? Math.max(...completed.map((r) => r.score)) : 0,
    highest_percent: percents.length ? Math.max(...percents) : 0,
    pass_count: passCount,
    pass_rate: passCount == null || !completed.length ? null : round1((passCount / completed.length) * 100),
    distribution,
  };
};

const formatName = (fullName, mode) => {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || mode === 'hidden') return null;
  if (mode === 'full') return parts.join(' ');
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.` : parts[0];
};

const examSummary = (exam) => ({
  id: exam.id,
  title: exam.title,
  slug: exam.slug,
  description: exam.description,
  opens_at: exam.opens_at,
  closes_at: exam.closes_at,
  duration_minutes: exam.mock_test.duration_minutes,
  total_questions: exam.mock_test.total_questions,
  total_marks: exam.mock_test.total_marks,
  pass_percent: exam.pass_percent,
  results_published_at: exam.results_published_at,
  public_results: exam.public_results,
});

// Public results are computed once a minute at most: the moment results go
// live is also the moment every candidate refreshes the page.
const resultsCache = new Map();
const RESULTS_CACHE_MS = 60_000;
const invalidateResultsCache = (examId) => resultsCache.delete(examId);

// ── Student ──────────────────────────────────────────────────────────────────

const findMyAttempt = (exam, userId) =>
  UserMockAttempt.findOne({
    where: { mock_test_id: exam.mock_test_id, user_id: userId },
    order: [['id', 'DESC']],
  });

const attemptState = (exam, attempt) => {
  if (!attempt) return null;
  const deadline = getDeadline(exam, attempt, exam.mock_test.duration_minutes);
  return {
    id: attempt.id,
    status: attempt.status,
    started_at: attempt.started_at,
    completed_at: attempt.completed_at,
    deadline,
    seconds_remaining: attempt.status === 'in_progress'
      ? Math.max(0, Math.floor((deadline - Date.now()) / 1000))
      : 0,
  };
};

/**
 * The exam currently switched on for students, or null. Drives both the
 * dashboard nav item (no exam → no item) and the exam page. Public, so the
 * nav can ask before anyone signs in; the student's own attempt is included
 * when there is a user.
 */
export const getCurrentExam = async (user) => {
  const exam = await LiveExam.findOne({
    where: { show_in_nav: true },
    include: [{ model: MockTest, as: 'mock_test' }],
    order: [['opens_at', 'DESC']],
  });
  if (!exam) return null;

  let myAttempt = null;
  if (user) {
    await finalizeExpired(exam, { userId: user.id });
    myAttempt = attemptState(exam, await findMyAttempt(exam, user.id));
  }

  return {
    ...examSummary(exam),
    instructions: exam.instructions,
    allow_answer_review: exam.allow_answer_review,
    blueprint: exam.mock_test.configuration_json?.blueprint ?? null,
    phase: getPhase(exam),
    server_now: new Date(),
    my_attempt: myAttempt,
  };
};

/**
 * Starts this student's one and only attempt, or returns the one already
 * running. Open to every signed-in student — no plan needed. Admins may start
 * before the exam opens, to rehearse; their attempts never count in results.
 */
export const startExam = async (user, examId) => {
  const exam = await loadExam(examId);
  const isAdmin = user.role === 'admin';
  const phase = getPhase(exam);

  if (!exam.show_in_nav && !isAdmin) throw new AppError('This exam is not available', 404);
  if (phase === 'upcoming' && !isAdmin) throw new AppError('This exam has not opened yet', 400);
  if (phase === 'closed' || phase === 'results') throw new AppError('This exam has closed', 400);
  if (new Date(exam.closes_at) - Date.now() < MIN_START_SECONDS * 1000) {
    throw new AppError('This exam is about to close — it is too late to start', 400);
  }

  return sequelize.transaction(async (t) => {
    // Serialises a double-click (or two tabs) into one attempt per student.
    await sequelize.query('SELECT pg_advisory_xact_lock(:examId, :userId)', {
      replacements: { examId: exam.id, userId: user.id }, transaction: t,
    });

    const existing = await UserMockAttempt.findOne({
      where: { mock_test_id: exam.mock_test_id, user_id: user.id },
      transaction: t,
    });
    if (existing?.status === 'in_progress') return { attempt_id: existing.id, resumed: true };
    if (existing) throw new AppError('You have already submitted this exam', 409);

    let questionIds = (await MockTestQuestion.findAll({
      where: { mock_test_id: exam.mock_test_id },
      order: [['question_order', 'ASC']],
      transaction: t,
    })).map((mq) => mq.question_id);
    if (!questionIds.length) throw new AppError('This exam has no questions yet', 400);
    if (exam.mock_test.randomize_questions) questionIds = shuffle(questionIds);

    const attempt = await UserMockAttempt.create(
      { user_id: user.id, mock_test_id: exam.mock_test_id, started_at: new Date() },
      { transaction: t }
    );
    await AttemptQuestion.bulkCreate(
      questionIds.map((qid, i) => ({ attempt_id: attempt.id, question_id: qid, question_order: i + 1 })),
      { transaction: t }
    );
    return { attempt_id: attempt.id, resumed: false };
  });
};

const shuffle = (items) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/**
 * The paper for this student's running attempt — question text, images and
 * options only. Nothing that reveals an answer (is_correct, explanations,
 * answer images) is ever selected, and like the real exam no subject is shown.
 */
export const getMyAttempt = async (user, examId) => {
  const exam = await loadExam(examId);
  await finalizeExpired(exam, { userId: user.id });
  const attempt = await findMyAttempt(exam, user.id);
  if (!attempt) throw new AppError('You have not started this exam', 404);

  const state = attemptState(exam, attempt);
  if (attempt.status !== 'in_progress') return { exam: examSummary(exam), attempt: state, questions: [], answers: {} };

  const attemptQuestions = await AttemptQuestion.findAll({
    where: { attempt_id: attempt.id },
    order: [['question_order', 'ASC']],
    include: [{
      model: Question, as: 'question',
      attributes: ['id', 'question_text', 'question_image', 'question_images'],
      include: [{ model: QuestionOption, as: 'options', attributes: ['id', 'option_key', 'option_text', 'option_image'] }],
    }],
  });
  const answers = await UserAnswer.findAll({
    where: { attempt_id: attempt.id },
    attributes: ['question_id', 'selected_option_id'],
  });

  return {
    exam: examSummary(exam),
    attempt: state,
    server_now: new Date(),
    questions: attemptQuestions.map((aq) => ({
      question_id: aq.question_id,
      order: aq.question_order,
      question_text: aq.question.question_text,
      question_image: aq.question.question_image,
      question_images: aq.question.question_images,
      options: [...aq.question.options]
        .sort((a, b) => String(a.option_key).localeCompare(String(b.option_key)))
        .map((o) => o.toJSON()),
    })),
    answers: Object.fromEntries(
      answers.filter((a) => a.selected_option_id != null).map((a) => [a.question_id, a.selected_option_id])
    ),
  };
};

const loadRunningAttempt = async (exam, userId) => {
  const attempt = await findMyAttempt(exam, userId);
  if (!attempt || attempt.status !== 'in_progress') throw new AppError('You have no exam in progress', 409);
  return attempt;
};

/** Saves (or, with selected_option_id null, clears) one answer. Refused once time is up. */
export const saveAnswer = async (user, examId, { question_id, selected_option_id }) => {
  const exam = await loadExam(examId);
  const attempt = await loadRunningAttempt(exam, user.id);

  const deadline = getDeadline(exam, attempt, exam.mock_test.duration_minutes);
  if (Date.now() > deadline.getTime() + ANSWER_GRACE_SECONDS * 1000) {
    await finalizeExpired(exam, { userId: user.id });
    throw new AppError('Time is up — your exam has been submitted', 409);
  }

  const questionId = Number(question_id);
  const optionId = selected_option_id == null ? null : Number(selected_option_id);
  const inAttempt = await AttemptQuestion.count({ where: { attempt_id: attempt.id, question_id: questionId } });
  if (!inAttempt) throw new AppError('Question not part of this exam', 400);
  if (optionId != null) {
    const validOption = await QuestionOption.count({ where: { id: optionId, question_id: questionId } });
    if (!validOption) throw new AppError('That option does not belong to this question', 400);
  }

  await sequelize.transaction(async (t) => {
    // One row per question even if two saves race (double tap, retry).
    await sequelize.query('SELECT pg_advisory_xact_lock(:attemptId, :questionId)', {
      replacements: { attemptId: attempt.id, questionId }, transaction: t,
    });
    const existing = await UserAnswer.findOne({ where: { attempt_id: attempt.id, question_id: questionId }, transaction: t });
    if (existing) await existing.update({ selected_option_id: optionId, answered_at: new Date() }, { transaction: t });
    else await UserAnswer.create(
      { attempt_id: attempt.id, question_id: questionId, selected_option_id: optionId, answered_at: new Date() },
      { transaction: t }
    );
  });
  return { saved: true };
};

/** Hands the exam in. The response says only that it was recorded — no score. */
export const submitExam = async (user, examId) => {
  const exam = await loadExam(examId);
  const attempt = await loadRunningAttempt(exam, user.id);
  const deadline = getDeadline(exam, attempt, exam.mock_test.duration_minutes);
  const completedAt = new Date(Math.min(Date.now(), deadline.getTime()));
  await sequelize.transaction((t) => gradeAttempt(attempt, { transaction: t, completedAt }));
  invalidateResultsCache(exam.id);
  return { submitted: true, completed_at: completedAt };
};

/** This student's own result — only once results are published. */
export const getMyResult = async (user, examId) => {
  const exam = await loadExam(examId);
  if (!exam.results_published_at) throw new AppError('Results have not been published yet', 403);

  const attempt = await findMyAttempt(exam, user.id);
  if (!attempt || attempt.status !== 'completed') throw new AppError('You did not sit this exam', 404);

  const standings = await loadStandings(exam);
  const completed = standings.filter((r) => r.status === 'completed');
  const mine = standings.find((r) => r.attempt_id === attempt.id);
  const [myBreakdown, allBreakdown] = await Promise.all([
    loadDomainBreakdown(exam, attempt.id),
    loadDomainBreakdown(exam),
  ]);
  const cohort = new Map(summarizeDomains(allBreakdown).map((d) => [d.key, d.average_percent]));

  const result = {
    exam: examSummary(exam),
    // An admin's rehearsal attempt has no standing; it still gets its numbers.
    me: {
      rank: mine?.rank ?? null,
      candidates: completed.length,
      percentile: mine && completed.length
        ? Math.round((completed.filter((r) => r.score < mine.score).length / completed.length) * 100)
        : null,
      score: attempt.score,
      percent: percentOf(attempt.score, exam.mock_test.total_marks || exam.mock_test.total_questions),
      passed: mine?.passed ?? null,
      total_correct: attempt.total_correct,
      total_wrong: attempt.total_wrong,
      total_unanswered: attempt.total_unanswered,
      time_taken_seconds: attempt.time_taken_seconds,
    },
    domains: [...EXAM_DOMAINS.map((d) => d.key), 'other']
      .map((key) => myBreakdown.find((r) => r.domain === key))
      .filter(Boolean)
      .map((r) => ({
        key: r.domain,
        label: domainLabel(r.domain),
        total: r.total,
        correct: r.correct,
        wrong: r.wrong,
        unanswered: r.total - r.correct - r.wrong,
        percent: r.total ? Math.round((r.correct / r.total) * 1000) / 10 : 0,
        cohort_average_percent: cohort.get(r.domain) ?? null,
      })),
    allow_answer_review: exam.allow_answer_review,
    review: null,
  };

  if (exam.allow_answer_review) result.review = await loadAttemptReview(attempt.id);
  return result;
};

/** Every question of an attempt with the student's answer, the right one and the explanations. */
const loadAttemptReview = async (attemptId) => {
  const [attemptQuestions, answers] = await Promise.all([
    AttemptQuestion.findAll({
      where: { attempt_id: attemptId },
      order: [['question_order', 'ASC']],
      include: [{
        model: Question, as: 'question',
        attributes: ['id', 'question_text', 'question_image', 'question_images', 'answer_images', 'explanation'],
        include: [
          { model: QuestionOption, as: 'options', attributes: ['id', 'option_key', 'option_text', 'option_image', 'is_correct', 'explanation'] },
          { model: Subject, as: 'subject', attributes: ['name', 'exam_domain'] },
        ],
      }],
    }),
    UserAnswer.findAll({ where: { attempt_id: attemptId } }),
  ]);
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));

  return attemptQuestions.map((aq) => {
    const q = aq.question;
    const answer = answerMap.get(aq.question_id);
    return {
      order: aq.question_order,
      question_id: q.id,
      question_text: q.question_text,
      question_image: q.question_image,
      question_images: q.question_images,
      answer_images: q.answer_images,
      explanation: q.explanation,
      subject: q.subject?.name ?? null,
      domain: domainLabel(q.subject?.exam_domain),
      options: [...q.options]
        .sort((a, b) => String(a.option_key).localeCompare(String(b.option_key)))
        .map((o) => o.toJSON()),
      selected_option_id: answer?.selected_option_id ?? null,
      is_correct: answer?.selected_option_id == null ? null : answer.is_correct,
    };
  });
};

// ── Public results ───────────────────────────────────────────────────────────

/** Exams whose results are public, newest first — the public results index. */
export const listPublishedResults = async () => {
  const exams = await LiveExam.findAll({
    where: { results_published_at: { [Op.ne]: null }, public_results: true },
    include: [{ model: MockTest, as: 'mock_test' }],
    order: [['opens_at', 'DESC']],
  });
  return exams.map(examSummary);
};

/** The public results page: statistics, domain averages and the leaderboard. */
export const getPublicResults = async (slug) => {
  const exam = await LiveExam.findOne({
    where: { slug, results_published_at: { [Op.ne]: null }, public_results: true },
    include: [{ model: MockTest, as: 'mock_test' }],
  });
  if (!exam) throw new AppError('Results not found', 404);

  const cached = resultsCache.get(exam.id);
  if (cached && cached.expires > Date.now() && cached.publishedAt === exam.results_published_at.getTime()) {
    return cached.value;
  }

  const standings = await loadStandings(exam);
  const completed = standings.filter((r) => r.status === 'completed');
  const value = {
    exam: examSummary(exam),
    stats: buildStats(exam, completed),
    domains: summarizeDomains(await loadDomainBreakdown(exam)),
    name_display: exam.name_display,
    leaderboard: completed.slice(0, exam.leaderboard_size).map((r) => ({
      rank: r.rank,
      name: formatName(r.full_name, exam.name_display),
      country: r.country,
      score: r.score,
      percent: r.percent,
      passed: r.passed,
    })),
  };
  resultsCache.set(exam.id, { value, expires: Date.now() + RESULTS_CACHE_MS, publishedAt: exam.results_published_at.getTime() });
  return value;
};

// ── Admin ────────────────────────────────────────────────────────────────────

const slugify = (text) =>
  String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const uniqueSlug = async (base, excludeId = null) => {
  const root = slugify(base) || 'live-exam';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const taken = await LiveExam.count({
      where: { slug: candidate, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    });
    if (!taken) return candidate;
  }
};

const parseDate = (value, label) => {
  const date = new Date(value);
  if (value == null || value === '' || Number.isNaN(date.getTime())) throw new AppError(`${label} is not a valid date and time`, 400);
  return date;
};

/** Validates the editable settings; only keys present in `input` are returned. */
const parseSettings = (input, current = {}) => {
  const out = {};
  if ('title' in input) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw new AppError('Title is required', 400);
    if (title.length > 200) throw new AppError('Title is too long', 400);
    out.title = title;
  }
  for (const key of ['description', 'instructions']) {
    if (key in input) out[key] = typeof input[key] === 'string' && input[key].trim() ? input[key].trim() : null;
  }
  if ('opens_at' in input) out.opens_at = parseDate(input.opens_at, 'Opening time');
  if ('closes_at' in input) out.closes_at = parseDate(input.closes_at, 'Closing time');
  const opens = out.opens_at ?? current.opens_at;
  const closes = out.closes_at ?? current.closes_at;
  if (opens && closes && closes <= opens) throw new AppError('Closing time must be after opening time', 400);

  if ('allow_answer_review' in input) out.allow_answer_review = Boolean(input.allow_answer_review);
  if ('public_results' in input) out.public_results = Boolean(input.public_results);
  if ('release_as_mock' in input) out.release_as_mock = Boolean(input.release_as_mock);
  if ('leaderboard_size' in input) {
    const size = Number(input.leaderboard_size);
    if (!Number.isInteger(size) || size < 0 || size > MAX_LEADERBOARD) {
      throw new AppError(`Leaderboard size must be a whole number from 0 to ${MAX_LEADERBOARD}`, 400);
    }
    out.leaderboard_size = size;
  }
  if ('name_display' in input) {
    if (!NAME_DISPLAY_MODES.includes(input.name_display)) throw new AppError('Invalid name display', 400);
    out.name_display = input.name_display;
  }
  if ('pass_percent' in input) {
    if (input.pass_percent === null || input.pass_percent === '') out.pass_percent = null;
    else {
      const pass = Number(input.pass_percent);
      if (!Number.isFinite(pass) || pass < 0 || pass > 100) throw new AppError('Pass mark must be between 0 and 100', 400);
      out.pass_percent = pass;
    }
  }
  return out;
};

const countAttempts = async (exam) => {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) FILTER (WHERE a.status = 'in_progress')::int AS in_progress,
            COUNT(*) FILTER (WHERE a.status = 'completed')::int AS submitted,
            COUNT(*)::int AS started
       FROM user_mock_attempts a
       JOIN users u ON u.id = a.user_id
      WHERE a.mock_test_id = :mockTestId AND u.role <> 'admin'`,
    { replacements: { mockTestId: exam.mock_test_id }, type: QueryTypes.SELECT }
  );
  return row;
};

const adminView = async (exam) => ({
  ...exam.toJSON(),
  phase: getPhase(exam),
  mock_test: {
    id: exam.mock_test.id,
    title: exam.mock_test.title,
    duration_minutes: exam.mock_test.duration_minutes,
    total_questions: exam.mock_test.total_questions,
    total_marks: exam.mock_test.total_marks,
    blueprint: exam.mock_test.configuration_json?.blueprint ?? null,
  },
  released_mock_test: exam.released_mock_test_id
    ? await MockTest.findByPk(exam.released_mock_test_id, { attributes: ['id', 'title', 'is_published'] })
    : null,
  counts: await countAttempts(exam),
  admin_test_attempts: await UserMockAttempt.count({
    where: { mock_test_id: exam.mock_test_id },
    include: [{ association: 'user', where: { role: 'admin' }, attributes: [] }],
  }),
});

export const listExams = async () => {
  const exams = await LiveExam.findAll({
    include: [{ model: MockTest, as: 'mock_test' }],
    order: [['opens_at', 'DESC']],
  });
  return Promise.all(exams.map(adminView));
};

export const getExam = async (id) => {
  const exam = await loadExam(id);
  await finalizeExpired(exam);
  return adminView(exam);
};

/**
 * Creates a live exam, hidden from students until switched on. The paper is
 * either generated now in the AMC weightage (`generate`) or an existing fixed
 * mock nobody has seen (`mock_test_id`).
 */
export const createExam = async (input) => {
  const settings = parseSettings(input);
  for (const key of ['title', 'opens_at', 'closes_at']) {
    if (!(key in settings)) throw new AppError(`${key.replace('_', ' ')} is required`, 400);
  }

  let mockTestId;
  if (input.mock_test_id) {
    // The exam sits a COPY: the original stays exactly as it is in Mock Exams,
    // and live attempts never mix with practice attempts on it.
    const source = await MockTest.findByPk(input.mock_test_id);
    if (!source) throw new AppError('Mock test not found', 404);
    if (source.test_type !== 'fixed') throw new AppError('A live exam needs a fixed paper — every student must get the same questions', 400);
    if (await LiveExam.count({ where: { mock_test_id: source.id } })) throw new AppError('That mock is already a live exam paper — pick a regular mock', 400);
    const copy = await sequelize.transaction((t) => copyPaper(source, {
      title: `${settings.title} — live exam paper`, isPublished: false, transaction: t,
    }));
    mockTestId = copy.id;
  } else if (input.generate) {
    const { mock_test: mock } = await createWeightedMock({
      title: `${settings.title} — live exam paper`,
      question_count: input.generate.question_count,
      duration_minutes: input.generate.duration_minutes,
    });
    mockTestId = mock.id;
  } else {
    throw new AppError('Choose a paper: generate one or pick an existing mock', 400);
  }

  const exam = await LiveExam.create({
    ...settings,
    slug: await uniqueSlug(input.slug || settings.title),
    mock_test_id: mockTestId,
    show_in_nav: false,
  });
  return getExam(exam.id);
};

export const updateExam = async (id, input) => {
  const exam = await loadExam(id);
  const settings = parseSettings(input, exam);
  if ('slug' in input) settings.slug = await uniqueSlug(input.slug || exam.title, exam.id);
  await exam.update(settings);
  invalidateResultsCache(exam.id);
  // Closing early (closes_at moved to now) ends every running attempt at once.
  await finalizeExpired(exam);
  return getExam(exam.id);
};

/** The student-facing switch. Turning one exam on turns any other off. */
export const setVisibility = async (id, showInNav) => {
  const exam = await loadExam(id);
  await sequelize.transaction(async (t) => {
    if (showInNav) {
      await LiveExam.update({ show_in_nav: false }, { where: { id: { [Op.ne]: exam.id } }, transaction: t });
    }
    await exam.update({ show_in_nav: Boolean(showInNav) }, { transaction: t });
  });
  return getExam(exam.id);
};

const uniqueMockTitle = async (base, transaction) => {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base} (${n})`;
    const taken = await MockTest.count({ where: { title: candidate }, transaction });
    if (!taken) return candidate;
  }
};

/** A new fixed mock with the same settings and questions, in the same order. */
const copyPaper = async (source, { title, isPublished, transaction }) => {
  const copy = await MockTest.create({
    title: await uniqueMockTitle(title, transaction),
    description: source.description,
    duration_minutes: source.duration_minutes,
    total_questions: source.total_questions,
    total_marks: source.total_marks,
    test_type: 'fixed',
    randomize_questions: source.randomize_questions,
    randomize_options: source.randomize_options,
    configuration_json: source.configuration_json,
    is_published: isPublished,
    is_free: false,
  }, { transaction });
  const questions = await MockTestQuestion.findAll({ where: { mock_test_id: source.id }, transaction });
  await MockTestQuestion.bulkCreate(
    questions.map((q) => ({ mock_test_id: copy.id, question_id: q.question_id, question_order: q.question_order })),
    { transaction }
  );
  return copy;
};

/**
 * Adds the paper to the regular Mock Exams as a published practice mock — a
 * copy, so practice attempts stay apart from the live ones. Idempotent: a
 * second call returns the copy already made (unless it was deleted since).
 */
const releaseToMocks = async (exam) => {
  if (exam.released_mock_test_id && await MockTest.count({ where: { id: exam.released_mock_test_id } })) return;
  await sequelize.transaction(async (t) => {
    const copy = await copyPaper(exam.mock_test, { title: exam.title, isPublished: true, transaction: t });
    await exam.update({ released_mock_test_id: copy.id }, { transaction: t });
  });
};

export const releasePaper = async (id) => {
  const exam = await loadExam(id);
  if (getPhase(exam) === 'upcoming' || getPhase(exam) === 'open') {
    throw new AppError('The exam is still open — its questions cannot go into Mock Exams yet', 400);
  }
  await releaseToMocks(exam);
  return getExam(exam.id);
};

export const publishResults = async (id) => {
  const exam = await loadExam(id);
  if (getPhase(exam) === 'upcoming' || getPhase(exam) === 'open') {
    throw new AppError('The exam is still open — close it before publishing results', 400);
  }
  await finalizeExpired(exam);
  await exam.update({ results_published_at: new Date() });
  invalidateResultsCache(exam.id);
  if (exam.release_as_mock) await releaseToMocks(exam);
  return getExam(exam.id);
};

export const unpublishResults = async (id) => {
  const exam = await loadExam(id);
  await exam.update({ results_published_at: null });
  invalidateResultsCache(exam.id);
  return getExam(exam.id);
};

/** Removes the event only; its paper stays behind as an unpublished mock. */
export const deleteExam = async (id) => {
  const exam = await loadExam(id);
  const attempts = await UserMockAttempt.count({ where: { mock_test_id: exam.mock_test_id } });
  if (attempts) {
    throw new AppError(`${attempts} attempt(s) exist — reset them first, or keep the exam for its records`, 400);
  }
  await exam.destroy();
  return { message: 'Live exam deleted. Its paper is still under Mock Tests.' };
};

/** Every candidate with their counts and rank, plus the headline statistics. */
export const getResults = async (id) => {
  const exam = await loadExam(id);
  await finalizeExpired(exam);
  const standings = await loadStandings(exam, { includeAdmins: true });
  const completed = standings.filter((r) => r.status === 'completed' && !r.is_admin);
  const breakdown = await loadDomainBreakdown(exam);
  const byAttempt = Map.groupBy(breakdown, (r) => r.attempt_id);

  return {
    exam: examSummary(exam),
    stats: buildStats(exam, completed),
    domains: summarizeDomains(breakdown),
    candidates: standings.map((r) => ({
      ...r,
      domains: Object.fromEntries((byAttempt.get(r.attempt_id) ?? []).map((d) => [
        d.domain, { total: d.total, correct: d.correct, wrong: d.wrong },
      ])),
    })),
  };
};

const csvCell = (value) => {
  if (value == null) return '';
  const text = String(value);
  // Leading =, +, - or @ would run as a formula when the file is opened in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const getResultsCsv = async (id) => {
  const { exam, candidates: all } = await getResults(id);
  const candidates = all.filter((c) => !c.is_admin);
  const domainKeys = EXAM_DOMAINS.map((d) => d.key);
  const header = [
    'Rank', 'Name', 'Email', 'Country', 'Status', 'Score', 'Percent', 'Passed',
    'Correct', 'Wrong', 'Unanswered', 'Answered', 'Questions', 'Time taken (min)', 'Started at', 'Submitted at',
    ...domainKeys.map((k) => `${domainLabel(k)} correct`),
  ];
  const rows = candidates.map((c) => [
    c.rank, c.full_name, c.email, c.country, c.status, c.score, c.percent,
    c.passed == null ? '' : c.passed ? 'yes' : 'no',
    c.total_correct, c.total_wrong, c.total_unanswered, c.answered_count, c.question_count,
    c.status === 'completed' ? Math.round(c.time_taken_seconds / 6) / 10 : '',
    c.started_at?.toISOString?.() ?? c.started_at, c.completed_at?.toISOString?.() ?? c.completed_at ?? '',
    ...domainKeys.map((k) => (c.domains[k] ? `${c.domains[k].correct}/${c.domains[k].total}` : '')),
  ]);
  return {
    filename: `${exam.slug}-results.csv`,
    // BOM so Excel reads the names as UTF-8.
    body: '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'),
  };
};

/** One candidate's paper: every question, what they chose and what was right. */
export const getAttemptDetail = async (id, attemptId) => {
  const exam = await loadExam(id);
  const attempt = await UserMockAttempt.findOne({
    where: { id: attemptId, mock_test_id: exam.mock_test_id },
    include: [{ association: 'user', attributes: ['id', 'fullName', 'email', 'country', 'role'] }],
  });
  if (!attempt) throw new AppError('Attempt not found', 404);
  const review = await loadAttemptReview(attempt.id);
  return {
    attempt: { ...attemptState(exam, attempt), score: attempt.score, total_correct: attempt.total_correct,
      total_wrong: attempt.total_wrong, total_unanswered: attempt.total_unanswered,
      time_taken_seconds: attempt.time_taken_seconds },
    user: attempt.user,
    // A running attempt is not marked yet; show what was picked, not right/wrong.
    questions: attempt.status === 'completed' ? review : review.map((q) => ({ ...q, is_correct: null })),
  };
};

/** Per question: how many got it right and how the picks spread over the options. */
export const getQuestionStats = async (id) => {
  const exam = await loadExam(id);
  const [questions, picks] = await Promise.all([
    MockTestQuestion.findAll({
      where: { mock_test_id: exam.mock_test_id },
      order: [['question_order', 'ASC']],
      include: [{
        model: Question, as: 'question',
        attributes: ['id', 'question_text'],
        include: [
          { model: QuestionOption, as: 'options', attributes: ['id', 'option_key', 'option_text', 'is_correct'] },
          { model: Subject, as: 'subject', attributes: ['name', 'exam_domain'] },
        ],
      }],
    }),
    sequelize.query(
      `SELECT ua.question_id, ua.selected_option_id, COUNT(*)::int AS count
         FROM user_answers ua
         JOIN user_mock_attempts a ON a.id = ua.attempt_id
         JOIN users u ON u.id = a.user_id
        WHERE a.mock_test_id = :mockTestId AND a.status = 'completed' AND u.role <> 'admin'
          AND ua.selected_option_id IS NOT NULL
        GROUP BY ua.question_id, ua.selected_option_id`,
      { replacements: { mockTestId: exam.mock_test_id }, type: QueryTypes.SELECT }
    ),
  ]);
  const { submitted } = await countAttempts(exam);
  const picksByQuestion = Map.groupBy(picks, (p) => p.question_id);

  return {
    candidates: submitted,
    questions: questions.map((mq, index) => {
      const q = mq.question;
      const qPicks = new Map((picksByQuestion.get(q.id) ?? []).map((p) => [p.selected_option_id, p.count]));
      const answered = [...qPicks.values()].reduce((a, b) => a + b, 0);
      const correctOption = q.options.find((o) => o.is_correct);
      const correct = correctOption ? qPicks.get(correctOption.id) ?? 0 : 0;
      return {
        number: index + 1,
        question_id: q.id,
        question_text: q.question_text,
        subject: q.subject?.name ?? null,
        domain: domainLabel(q.subject?.exam_domain),
        correct_option_key: correctOption?.option_key ?? null,
        answered,
        unanswered: submitted - answered,
        correct,
        correct_percent: submitted ? Math.round((correct / submitted) * 1000) / 10 : 0,
        options: [...q.options]
          .sort((a, b) => String(a.option_key).localeCompare(String(b.option_key)))
          .map((o) => ({ option_key: o.option_key, option_text: o.option_text, is_correct: o.is_correct, picks: qPicks.get(o.id) ?? 0 })),
      };
    }),
  };
};

/**
 * Deletes one attempt so that student can sit the exam again — for a genuine
 * technical problem, or to clear an admin's rehearsal run.
 */
export const resetAttempt = async (id, attemptId) => {
  const exam = await loadExam(id);
  const attempt = await UserMockAttempt.findOne({ where: { id: attemptId, mock_test_id: exam.mock_test_id } });
  if (!attempt) throw new AppError('Attempt not found', 404);
  await sequelize.transaction(async (t) => {
    await UserAnswer.destroy({ where: { attempt_id: attempt.id }, transaction: t });
    await AttemptQuestion.destroy({ where: { attempt_id: attempt.id }, transaction: t });
    await attempt.destroy({ transaction: t });
  });
  invalidateResultsCache(exam.id);
  return { message: 'Attempt reset — this student can start the exam again' };
};
