import { Op } from 'sequelize';
import { sequelize, Question, QuestionOption, Subject, Topic, QuestionProgress, ImportBatch, BookmarkedQuestion } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { assertSectionAccess, restrictToEntitled } from './entitlement.service.js';
import { SECTIONS } from '../constants/sections.js';
import { PRACTICE_SCOPES, isPracticeScope } from '../constants/practiceScopes.js';

const assertOptionalId = (value, name) => {
  if (value !== undefined && value !== '' && !/^\d+$/.test(String(value))) {
    throw new AppError(`${name} must be a number`, 400);
  }
};

/** Missing means 'default', so Recall and older clients need not send it. */
const parsePracticeScope = (value) => {
  if (value === undefined || value === '') return PRACTICE_SCOPES.DEFAULT;
  if (!isPracticeScope(value)) throw new AppError(`Unknown practice_scope "${value}"`, 400);
  return value;
};

const buildWhere = (query) => {
  const { subject_id, topic_id, difficulty, question_type, source_type, search, is_active, import_batch_id } = query;
  assertOptionalId(subject_id, 'subject_id');
  assertOptionalId(topic_id, 'topic_id');
  const where = {};
  if (import_batch_id) where.import_batch_id = import_batch_id;
  if (subject_id) where.subject_id = subject_id;
  if (topic_id) where.topic_id = topic_id;
  if (difficulty) where.difficulty = difficulty;
  if (question_type) where.question_type = question_type;
  if (source_type) where.source_type = source_type;
  if (is_active !== undefined) where.is_active = is_active === 'true';
  if (search) where.question_text = { [Op.iLike]: `%${search}%` };
  return where;
};

const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(500, parseInt(query.limit) || 20);
  return { limit, offset: (page - 1) * limit, page };
};

/**
 * A where-fragment that limits questions to the ones students are meant to see.
 *
 * Two rules, both about import batches:
 *
 * 1. A batch is the student-facing grouping for recalls — one upload is one
 *    month ("August Recall 2026") — and hiding a batch must take its questions
 *    out of practice everywhere: lists, single fetches, answer checks and
 *    progress.
 *
 * 2. A recall question that belongs to no batch is unfiled, not published. It
 *    is either waiting to be moved between batches or was written by hand and
 *    not grouped yet, and either way it has no month to appear under. Unfiled
 *    recall questions used to be bundled into a synthetic "Other questions"
 *    batch, which meant taking a question out of a batch quietly republished it
 *    somewhere else instead of withdrawing it.
 *
 * The batch requirement is deliberately scoped to recall. Other modes are not
 * organised by batch at all, so a hand-written qbank question having no batch
 * is normal and excluding it would make it silently vanish.
 *
 * Returned under Op.and rather than as a bare `import_batch_id` key: callers
 * spread this next to their own `import_batch_id` filter — "answered 10 of 40"
 * for one month — and a second string key of the same name would overwrite it.
 *
 * Hidden ids are looked up first rather than joining and filtering on
 * `$import_batch.is_visible$`. The question list includes a hasMany
 * association, so Sequelize wraps the query in a limit subquery that the joined
 * table is not part of, and a where against it fails at runtime. There are only
 * ever a handful of batches, so the extra query is free.
 */
const inVisibleBatch = async () => {
  const clauses = [
    {
      [Op.or]: [
        { source_type: { [Op.ne]: 'recall' } },
        { import_batch_id: { [Op.ne]: null } },
      ],
    },
  ];

  const hidden = await ImportBatch.findAll({
    where: { is_visible: false },
    attributes: ['id'],
  });

  if (hidden.length) {
    clauses.push({
      [Op.or]: [
        { import_batch_id: null },
        { import_batch_id: { [Op.notIn]: hidden.map((b) => b.id) } },
      ],
    });
  }

  return { [Op.and]: clauses };
};

/**
 * The condition for "this question is a free sample".
 *
 * True when the question is flagged itself, or when it sits in a batch that has
 * been opened wholesale. Recall is sold and consumed by the month, so giving a
 * whole sitting away is the unit that makes sense there; individual flags cover
 * qbank, where there are no batches to speak of.
 *
 * Batch ids are fetched first rather than filtered through
 * `$import_batch.is_free$`, for the same reason inVisibleBatch does it — see
 * the note there about the limit subquery.
 */
const sampleScope = async () => {
  const freeBatches = await ImportBatch.findAll({
    where: { is_free: true },
    attributes: ['id'],
  });

  if (!freeBatches.length) return { is_free: true };

  return {
    [Op.or]: [
      { is_free: true },
      { import_batch_id: { [Op.in]: freeBatches.map((b) => b.id) } },
    ],
  };
};

/**
 * Whether one already-loaded question counts as a sample.
 *
 * import_batch_id is deliberately excluded from the student payload (a student
 * has no business knowing batch ids), so on that path the field is absent
 * rather than null and has to be fetched. Absent and null mean different
 * things here — null is "belongs to no batch", which is a real answer.
 */
const isSample = async (question) => {
  if (question.is_free) return true;

  const batchId =
    question.import_batch_id === undefined
      ? (await Question.findByPk(question.id, { attributes: ['import_batch_id'] }))
          ?.import_batch_id
      : question.import_batch_id;

  if (!batchId) return false;

  const batch = await ImportBatch.findByPk(batchId, { attributes: ['is_free'] });
  return Boolean(batch?.is_free);
};

const subjectTopicIncludes = (withCorrect) => [
  // withCorrect=true  → admin, returns all fields
  // withCorrect=false → student list, strips is_correct + explanation (revealed via /check)
  {
    model: QuestionOption, as: 'options',
    attributes: withCorrect
      ? undefined
      : ['id', 'option_key', 'option_text', 'option_image'],
  },
  { model: Subject, as: 'subject', attributes: ['id', 'name'] },
  { model: Topic, as: 'topic', attributes: ['id', 'name'] },
];

// ── Admin ────────────────────────────────────────
export const adminListQuestions = async (query) => {
  const where = buildWhere(query);
  const { limit, offset, page } = paginate(query);
  const { count, rows } = await Question.findAndCountAll({
    where, include: subjectTopicIncludes(true), limit, offset,
    order: [['id', 'DESC']], distinct: true,
  });
  return { data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
};

export const adminGetQuestion = async (id) => {
  const q = await Question.findByPk(id, { include: subjectTopicIncludes(true) });
  if (!q) throw new AppError('Question not found', 404);
  return q;
};

export const createQuestion = async (data, createdBy) => {
  const { subject_id, topic_id, question_text, explanation, difficulty, question_type,
    source_type, source_year, marks, negative_marks, options } = data;

  if (!options?.length) throw new AppError('At least one option is required', 400);

  const t = await sequelize.transaction();
  try {
    const question = await Question.create(
      { subject_id, topic_id, question_text, explanation, difficulty, question_type,
        source_type, source_year, marks, negative_marks, created_by: createdBy },
      { transaction: t }
    );
    await QuestionOption.bulkCreate(
      options.map((o) => ({ question_id: question.id, option_key: o.option_key, option_text: o.option_text, is_correct: o.is_correct || false })),
      { transaction: t }
    );
    await t.commit();
    return Question.findByPk(question.id, { include: subjectTopicIncludes(true) });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export const updateQuestion = async (id, data) => {
  const question = await Question.findByPk(id);
  if (!question) throw new AppError('Question not found', 404);

  const { subject_id, topic_id, question_text, explanation, difficulty, question_type,
    source_type, source_year, marks, negative_marks,
    question_image, question_images, answer_images,
    options } = data;

  const t = await sequelize.transaction();
  try {
    await question.update(
      { subject_id, topic_id, question_text, explanation, difficulty, question_type,
        source_type, source_year, marks, negative_marks,
        question_image, question_images, answer_images },
      { transaction: t }
    );
    if (options?.length) {
      await QuestionOption.destroy({ where: { question_id: id }, transaction: t });
      await QuestionOption.bulkCreate(
        options.map((o) => ({ question_id: id, option_key: o.option_key, option_text: o.option_text, is_correct: o.is_correct || false })),
        { transaction: t }
      );
    }
    await t.commit();
    return Question.findByPk(id, { include: subjectTopicIncludes(true) });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export const deleteQuestion = async (id) => {
  const q = await Question.findByPk(id);
  if (!q) throw new AppError('Question not found', 404);
  await q.destroy();
  return { message: 'Question deleted' };
};

export const toggleQuestion = async (id) => {
  const q = await Question.findByPk(id);
  if (!q) throw new AppError('Question not found', 404);
  await q.update({ is_active: !q.is_active });
  return { id: q.id, is_active: q.is_active };
};

/**
 * Marks a question as a free sample, or takes it back behind the paywall.
 *
 * Its own endpoint rather than a field on updateQuestion: that one rewrites the
 * whole question and its options in a transaction, which is far more than a
 * single switch in a list should do.
 */
export const toggleQuestionFree = async (id) => {
  const q = await Question.findByPk(id);
  if (!q) throw new AppError('Question not found', 404);
  await q.update({ is_free: !q.is_free });
  return { id: q.id, is_free: q.is_free };
};

// ── Student ───────────────────────────────────────
// The explanation is the teaching content students pay for — it is revealed one
// question at a time by /check, never in a list a scraper can page through.
const STUDENT_QUESTION_ATTRIBUTES = { exclude: ['explanation', 'created_by', 'import_batch_id'] };

/**
 * Which entitlement each kind of question falls under.
 *
 * 'previous_year' is treated as question-bank material — it is sold as part of
 * the QBank rather than as its own product. Change the mapping here if that
 * stops being true; nothing else needs to know.
 */
const SOURCE_TYPE_SECTIONS = Object.freeze({
  qbank: SECTIONS.QBANK,
  recall: SECTIONS.RECALL,
  mock: SECTIONS.MOCKS,
  previous_year: SECTIONS.QBANK,
});

const ALL_SOURCE_TYPES = Object.freeze(Object.keys(SOURCE_TYPE_SECTIONS));

/**
 * A where-fragment narrowing a listing to what this user may see.
 *
 * Narrows rather than rejects, because of samples. A student who has not paid
 * still gets the questions marked is_free — that is the whole point of marking
 * them — so asking for a section they do not hold returns the samples for it
 * rather than a 403. An empty result is then honestly empty: there are no
 * samples in that section.
 *
 * With no source_type at all the answer is "everything in the sections you
 * hold, plus any sample anywhere", which is what a student browsing practice
 * questions should see.
 */
const entitledScope = async (query, user) => {
  const held = await restrictToEntitled(user, [...new Set(Object.values(SOURCE_TYPE_SECTIONS))]);

  if (query?.source_type) {
    const section = SOURCE_TYPE_SECTIONS[query.source_type];
    if (!section) throw new AppError(`Unknown source_type "${query.source_type}"`, 400);
    // buildWhere() already applied their source_type filter; all this adds is
    // the sample restriction when they have not paid for that section.
    return held.includes(section) ? {} : await sampleScope();
  }

  const allowed = ALL_SOURCE_TYPES.filter((type) => held.includes(SOURCE_TYPE_SECTIONS[type]));

  return {
    [Op.or]: [{ source_type: { [Op.in]: allowed } }, await sampleScope()],
  };
};

/**
 * Gate a single already-loaded question.
 *
 * A sample is open to any signed-in student, which is what makes it a sample.
 * Everything else needs the section it belongs to.
 */
const assertQuestionAccess = async (question, user) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (await isSample(question)) return;
  await assertSectionAccess(SOURCE_TYPE_SECTIONS[question.source_type] ?? SECTIONS.QBANK, user);
};

const PRACTICE_SUBSETS = Object.freeze(['incorrect', 'bookmarked']);

/**
 * A where-fragment narrowing practice to the student's own questions:
 * `only=incorrect` (last answered wrong in this practice scope) or
 * `only=bookmarked`. Applied identically to the id list and the question pages
 * so the pages stay aligned with the ids.
 *
 * Ids are looked up first rather than joined, for the same limit-subquery
 * reason given on inVisibleBatch.
 */
const practiceSubsetScope = async (query, user) => {
  if (!query.only) return {};
  if (!PRACTICE_SUBSETS.includes(query.only)) {
    throw new AppError(`only must be one of: ${PRACTICE_SUBSETS.join(', ')}`, 400);
  }

  const rows = query.only === 'incorrect'
    ? await QuestionProgress.findAll({
      where: { user_id: user.id, practice_scope: parsePracticeScope(query.practice_scope), is_correct: false },
      attributes: ['question_id'],
      raw: true,
    })
    : await BookmarkedQuestion.findAll({ where: { user_id: user.id }, attributes: ['question_id'], raw: true });

  return { id: { [Op.in]: rows.map((r) => r.question_id) } };
};

export const listQuestions = async (query, user) => {
  const where = {
    ...buildWhere(query),
    is_active: true,
    ...(await inVisibleBatch()),
    ...(await entitledScope(query, user)),
    ...(await practiceSubsetScope(query, user)),
  };
  const { limit, offset, page } = paginate(query);
  const { count, rows } = await Question.findAndCountAll({
    where, attributes: STUDENT_QUESTION_ATTRIBUTES,
    include: subjectTopicIncludes(false), limit, offset,
    order: [['id', 'ASC']], distinct: true,
  });
  return { data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
};

/**
 * Every question id a student may practise for one filter, in practice order.
 *
 * A QBank subject can hold thousands of questions — too many to send with
 * their options in one list. The client takes the ids up front to know the
 * total and where to resume, then pages through the full questions with
 * listQuestions, which uses the same filter and order.
 */
export const listQuestionIds = async (query, user) => {
  const rows = await Question.findAll({
    where: {
      ...buildWhere(query),
      is_active: true,
      ...(await inVisibleBatch()),
      ...(await entitledScope(query, user)),
      ...(await practiceSubsetScope(query, user)),
    },
    attributes: ['id'],
    order: [['id', 'ASC']],
    raw: true,
  });
  return rows.map((r) => r.id);
};

export const getQuestion = async (id, user) => {
  const q = await Question.findOne({
    // Hidden batches are excluded here too, not just in the list: otherwise a
    // student who kept a question id could still fetch it after the batch was
    // hidden.
    where: { id, is_active: true, ...(await inVisibleBatch()) },
    attributes: STUDENT_QUESTION_ATTRIBUTES,
    include: subjectTopicIncludes(false),
  });
  if (!q) throw new AppError('Question not found', 404);
  await assertQuestionAccess(q, user);
  return q;
};

// Called after the student picks an option — returns correct flag + full option details
export const checkAnswer = async (questionId, selectedOptionId, user, practiceScope) => {
  const scope = parsePracticeScope(practiceScope);
  const q = await Question.findOne({
    where: { id: questionId, is_active: true, ...(await inVisibleBatch()) },
    include: [{ model: QuestionOption, as: 'options' }],
  });
  if (!q) throw new AppError('Question not found', 404);

  // Checked before the reveal, not just before the list: this endpoint returns
  // the explanation, which is the part students actually pay for.
  await assertQuestionAccess(q, user);

  const userId = user?.id;

  const selected = q.options.find(o => o.id === selectedOptionId);
  if (!selected) throw new AppError('Option not found', 404);

  // Normalise answer_images to an array regardless of how it was stored
  const rawImages = q.answer_images;
  const answerImages = Array.isArray(rawImages)
    ? rawImages
    : typeof rawImages === 'string' && rawImages
      ? [rawImages]
      : [];

  // Recorded before the reveal is returned so the student's place is kept even
  // if they close the tab the instant they see the answer.
  //
  // Deliberately not fatal: a progress write failing must not turn a working
  // answer-check into an error. The worst case is that this one question is not
  // counted, and answering it again fixes that.
  if (userId) {
    try {
      await recordAnswer({
        userId,
        questionId: q.id,
        selectedOptionId: selected.id,
        isCorrect: selected.is_correct,
        practiceScope: scope,
      });
    } catch (err) {
      console.error(`Could not record practice progress for question ${q.id}:`, err.message);
    }
  }

  return {
    is_correct: selected.is_correct,
    correct_option_id: q.options.find(o => o.is_correct)?.id ?? null,
    explanation: q.explanation ?? null,
    answer_images: answerImages,
    options: q.options.map(o => ({
      id:           o.id,
      option_key:   o.option_key,
      option_text:  o.option_text,
      is_correct:   o.is_correct,
      explanation:  o.explanation ?? null,
      option_image: o.option_image ?? null,
    })),
  };
};


// ── Practice progress ─────────────────────────────────────────────────────────

/**
 * Upserts the student's answer for one question.
 *
 * Answering the same question again overwrites the previous row rather than
 * adding one, so "answered" stays a set — see the unique index on the model.
 */
const recordAnswer = async ({ userId, questionId, selectedOptionId, isCorrect, practiceScope }) => {
  const [row, created] = await QuestionProgress.findOrCreate({
    where: { user_id: userId, question_id: questionId, practice_scope: practiceScope },
    defaults: {
      selected_option_id: selectedOptionId,
      is_correct: isCorrect,
      answered_at: new Date(),
    },
  });

  if (!created) {
    await row.update({
      selected_option_id: selectedOptionId,
      is_correct: isCorrect,
      answered_at: new Date(),
    });
  }

  return row;
};

/**
 * The student's progress across one practice mode (source_type), used to resume
 * where they left off.
 *
 * Returns which questions were answered and how each went, rather than a
 * position. The client already holds the ordered question list and picks the
 * first id that is not in this set, which stays correct when questions are
 * added, deactivated or filtered — a stored index would not. The per-question
 * is_correct is what lets the score survive a logout instead of restarting at
 * zero.
 */
export const getPracticeProgress = async (userId, { source_type, import_batch_id, subject_id, topic_id, practice_scope } = {}) => {
  assertOptionalId(subject_id, 'subject_id');
  assertOptionalId(topic_id, 'topic_id');
  const rows = await QuestionProgress.findAll({
    where: { user_id: userId, practice_scope: parsePracticeScope(practice_scope) },
    attributes: ['question_id', 'is_correct'],
    include: [
      {
        model: Question,
        as: 'question',
        attributes: [],
        // required:true makes this an inner join, so progress for questions that
        // have since been deleted or deactivated simply drops out.
        required: true,
        where: {
          is_active: true,
          ...(source_type ? { source_type } : {}),
          // Scoped to one batch when asked, so "answered 10 of 146" counts the
          // set the student is actually looking at rather than every recall
          // they have ever done.
          ...(import_batch_id ? { import_batch_id } : {}),
          // QBank is practised one subject at a time rather than by upload.
          ...(subject_id ? { subject_id } : {}),
          ...(topic_id ? { topic_id } : {}),
          ...(await inVisibleBatch()),
        },
      },
    ],
  });

  return {
    answers: rows.map((r) => ({ question_id: r.question_id, is_correct: r.is_correct })),
    answered: rows.length,
    correct: rows.filter((r) => r.is_correct).length,
    wrong: rows.filter((r) => !r.is_correct).length,
  };
};

/**
 * Clears the student's practice progress for one mode, so they can work through
 * the set again from the beginning.
 *
 * source_type is required rather than optional-meaning-everything: a missing
 * query parameter would otherwise silently wipe the student's progress across
 * every practice mode at once, which is not something a "start over" button on
 * one page should be able to do.
 *
 * The question ids are looked up first and passed as a list rather than built
 * into a raw subquery — it keeps a caller-supplied value out of hand-written
 * SQL, and the practice sets are small enough that it makes no difference.
 */
export const resetPracticeProgress = async (userId, { source_type, import_batch_id, subject_id, topic_id, practice_scope } = {}) => {
  if (!source_type) throw new AppError('source_type is required', 400);
  assertOptionalId(subject_id, 'subject_id');
  assertOptionalId(topic_id, 'topic_id');
  const scope = parsePracticeScope(practice_scope);

  const questions = await Question.findAll({
    // Scoped to a batch when given, so starting over on July's recall does not
    // also wipe the student's progress through August.
    where: {
      source_type,
      ...(import_batch_id ? { import_batch_id } : {}),
      ...(subject_id ? { subject_id } : {}),
      ...(topic_id ? { topic_id } : {}),
    },
    attributes: ['id'],
  });

  if (!questions.length) return { cleared: 0 };

  const cleared = await QuestionProgress.destroy({
    where: {
      user_id: userId,
      practice_scope: scope,
      question_id: { [Op.in]: questions.map((q) => q.id) },
    },
  });

  return { cleared };
};

// ── Question subjects (QBank) ────────────────────────────────────────────────

/** Question counts grouped by one column (subject_id or topic_id), as a Map. */
const countByColumn = async (where, column) => {
  const rows = await Question.findAll({
    attributes: [column, [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where,
    group: [column],
    raw: true,
  });
  return new Map(rows.map((r) => [r[column], Number(r.count)]));
};

/**
 * This student's answered/correct counts over the questions matching `where`,
 * grouped by one column as a Map — or, with no column, one { answered, correct }.
 */
const countProgress = async (userId, practiceScope, where, column = null) => {
  const rows = await QuestionProgress.findAll({
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('QuestionProgress.id')), 'answered'],
      [sequelize.fn('COUNT', sequelize.literal('CASE WHEN "QuestionProgress"."is_correct" THEN 1 END')), 'correct'],
    ],
    where: { user_id: userId, practice_scope: practiceScope },
    include: [{
      model: Question, as: 'question', required: true, where,
      attributes: column ? [column] : [],
    }],
    ...(column ? { group: [`question.${column}`] } : {}),
    raw: true,
    nest: true,
  });
  const toCounts = (r) => ({ answered: Number(r?.answered ?? 0), correct: Number(r?.correct ?? 0) });
  return column
    ? new Map(rows.map((r) => [r.question[column], toCounts(r)]))
    : toCounts(rows[0]);
};

/** One card's worth of numbers for a subject or topic. */
const toPracticeGroup = ({ id, name }, totals, available, progress) => ({
  id,
  name,
  question_count: totals.get(id),
  available_count: available.get(id) ?? 0,
  answered_count: progress.get(id)?.answered ?? 0,
  correct_count: progress.get(id)?.correct ?? 0,
});

const byQuestionCountThenName = (a, b) => b.question_count - a.question_count || a.name.localeCompare(b.name);

const visibleQuestionsWhere = async (sourceType) => ({
  ...buildWhere({ source_type: sourceType }),
  is_active: true,
  ...(await inVisibleBatch()),
});

/**
 * The subjects a student can choose between for a practice mode — QBank is
 * one bank practised subject by subject, whichever upload a question came in.
 *
 * question_count is everything in the subject, so a student without a plan can
 * see how much there is to unlock; available_count is what they may open now
 * (the samples, or everything once they have paid). Questions with no subject
 * are left out — there is no subject to list them under; the admin assigns one.
 *
 * Per-subject progress and "All subjects" progress are separate practice
 * scopes, so each card counts only the answers given from it.
 */
export const listQuestionSubjects = async (query, user) => {
  const where = { ...(await visibleQuestionsWhere(query.source_type)), subject_id: { [Op.ne]: null } };

  const [totals, available, subjects, progress, allSubjectsProgress] = await Promise.all([
    countByColumn(where, 'subject_id'),
    countByColumn({ ...where, ...(await entitledScope(query, user)) }, 'subject_id'),
    Subject.findAll({ where: { is_active: true }, attributes: ['id', 'name'], raw: true }),
    countProgress(user.id, PRACTICE_SCOPES.DEFAULT, where, 'subject_id'),
    countProgress(user.id, PRACTICE_SCOPES.ALL_SUBJECTS, where),
  ]);

  const subjectList = subjects
    .filter((subject) => totals.has(subject.id))
    .map((subject) => toPracticeGroup(subject, totals, available, progress))
    .sort(byQuestionCountThenName);

  return {
    subjects: subjectList,
    all_subjects: {
      question_count: subjectList.reduce((sum, s) => sum + s.question_count, 0),
      available_count: subjectList.reduce((sum, s) => sum + s.available_count, 0),
      answered_count: allSubjectsProgress.answered,
      correct_count: allSubjectsProgress.correct,
    },
  };
};

/**
 * The topics inside one subject, for narrowing practice to e.g. Cardiology.
 *
 * Topic practice shares the subject's progress scope — a topic is part of its
 * subject, so an answer given under Cardiology also counts on Medicine.
 * `subject` totals the whole subject, including questions not tagged with a
 * topic yet, which are reachable only through it.
 */
export const listQuestionTopics = async (query, user) => {
  if (!query.subject_id) throw new AppError('subject_id is required', 400);
  assertOptionalId(query.subject_id, 'subject_id');

  const subject = await Subject.findOne({
    where: { id: query.subject_id, is_active: true },
    attributes: ['id', 'name'],
    raw: true,
  });
  if (!subject) throw new AppError('Subject not found', 404);

  const where = { ...(await visibleQuestionsWhere(query.source_type)), subject_id: subject.id };
  const entitledWhere = { ...where, ...(await entitledScope(query, user)) };

  const [totals, available, topics, progress, subjectTotal, subjectAvailable, subjectProgress] = await Promise.all([
    countByColumn(where, 'topic_id'),
    countByColumn(entitledWhere, 'topic_id'),
    Topic.findAll({ where: { subject_id: subject.id }, attributes: ['id', 'name'], raw: true }),
    countProgress(user.id, PRACTICE_SCOPES.DEFAULT, where, 'topic_id'),
    Question.count({ where }),
    Question.count({ where: entitledWhere }),
    countProgress(user.id, PRACTICE_SCOPES.DEFAULT, where),
  ]);

  return {
    subject: {
      ...subject,
      question_count: subjectTotal,
      available_count: subjectAvailable,
      answered_count: subjectProgress.answered,
      correct_count: subjectProgress.correct,
    },
    topics: topics
      .filter((topic) => totals.has(topic.id))
      .map((topic) => toPracticeGroup(topic, totals, available, progress))
      .sort(byQuestionCountThenName),
  };
};

// ── Question batches (recall months) ─────────────────────────────────────────

/**
 * The batches a student may choose between for a practice mode.
 *
 * One import batch is one month's recall ("August Recall 2026"), so this is
 * what drives the batch picker. Only visible batches that actually contain
 * active questions are returned — an empty or hidden batch is not something to
 * offer.
 *
 * Questions created by hand carry no batch. Rather than hiding them, they are
 * grouped under a single synthetic entry so they stay reachable.
 */
export const listQuestionBatches = async ({ source_type } = {}, user) => {
  const userId = user?.id;

  const rows = await Question.findAll({
    attributes: [
      'import_batch_id',
      [sequelize.fn('COUNT', sequelize.col('Question.id')), 'question_count'],
    ],
    where: {
      is_active: true,
      ...(source_type ? { source_type } : {}),
      import_batch_id: { [Op.ne]: null },
      ...(await inVisibleBatch()),
    },
    include: [
      {
        model: ImportBatch,
        as: 'import_batch',
        attributes: ['id', 'title', 'is_free', 'createdAt'],
        // Inner join: this endpoint answers "which batches can I practise",
        // and a question with no batch is not an answer to that.
        required: true,
      },
    ],
    group: ['Question.import_batch_id', 'import_batch.id', 'import_batch.is_free', 'import_batch.created_at'],
    raw: true,
    nest: true,
  });

  // How far this student has got in each batch, so the picker can say
  // "12 of 40 answered" and offer Continue rather than Start. One grouped query
  // rather than one per batch.
  const answeredByBatch = new Map();
  if (userId) {
    const progressRows = await QuestionProgress.findAll({
      attributes: [[sequelize.fn('COUNT', sequelize.col('QuestionProgress.id')), 'answered']],
      where: { user_id: userId, practice_scope: PRACTICE_SCOPES.DEFAULT },
      include: [
        {
          model: Question,
          as: 'question',
          attributes: ['import_batch_id'],
          required: true,
          where: { is_active: true, ...(source_type ? { source_type } : {}) },
        },
      ],
      group: ['question.import_batch_id'],
      raw: true,
      nest: true,
    });

    for (const row of progressRows) {
      answeredByBatch.set(row.question?.import_batch_id ?? null, Number(row.answered));
    }
  }

  return rows
    .map((r) => ({
      id: r.import_batch_id,
      title: r.import_batch.title,
      is_free: Boolean(r.import_batch?.is_free),
      question_count: Number(r.question_count),
      answered_count: answeredByBatch.get(r.import_batch_id) ?? 0,
      created_at: r.import_batch.createdAt,
    }))
    // Free batches lead regardless of upload order — a prospective buyer
    // should see "try this one free" before "buy this one". Newest first
    // within each group.
    .sort((a, b) => (b.is_free - a.is_free) || (new Date(b.created_at) - new Date(a.created_at)));
};

/**
 * Show or hide a batch for students. Admin only.
 *
 * Nothing is deleted: hiding is reversible, which is the point — a batch put up
 * for a demo can be taken down and restored later.
 */
/**
 * Opens or closes a whole batch as a free sample.
 *
 * Separate from visibility: hiding a batch takes it away from everyone,
 * including subscribers. This only changes who has to have paid to see it.
 */
export const setBatchFree = async (id, isFree) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Import batch not found', 404);

  await batch.update({ is_free: Boolean(isFree) });
  return { id: batch.id, title: batch.title, is_free: batch.is_free };
};

export const setBatchVisibility = async (id, isVisible) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Import batch not found', 404);

  await batch.update({ is_visible: Boolean(isVisible) });
  return { id: batch.id, title: batch.title, is_visible: batch.is_visible };
};
