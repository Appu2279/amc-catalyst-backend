import { QueryTypes, fn, col, where } from 'sequelize';
import { sequelize, MockTest, MockTestQuestion } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { EXAM_DOMAINS } from '../constants/examDomains.js';

// Originally recall-only (agreed with the client); QBank added 2026-09-30 so
// imported eMedici questions can fill papers too.
const SOURCE_TYPES = ['recall', 'qbank'];
const MIN_QUESTIONS = 20;
const MAX_QUESTIONS = 300;
const MAX_DURATION_MINUTES = 600;

/**
 * Every question a weighted mock may use, with how many mocks already hold it.
 * Only scorable questions (2+ options, exactly one correct) from active,
 * domain-assigned subjects qualify.
 */
const loadPool = () =>
  sequelize.query(
    `SELECT q.id, q.subject_id, q.marks, s.exam_domain,
            COALESCE(usage.times_used, 0)::int AS times_used
       FROM questions q
       JOIN subjects s ON s.id = q.subject_id
       JOIN (SELECT question_id
               FROM question_options
              GROUP BY question_id
             HAVING COUNT(*) >= 2 AND COUNT(*) FILTER (WHERE is_correct) = 1) scorable
         ON scorable.question_id = q.id
       LEFT JOIN (SELECT question_id, COUNT(*) AS times_used
                    FROM mock_test_questions
                   GROUP BY question_id) usage
         ON usage.question_id = q.id
      WHERE q.is_active = true
        AND q.source_type IN (:sourceTypes)
        AND s.is_active = true
        AND s.exam_domain IS NOT NULL`,
    { replacements: { sourceTypes: SOURCE_TYPES }, type: QueryTypes.SELECT }
  );

/** Active subjects that have questions but no domain yet — their questions are left out. */
const loadUnassignedSubjects = () =>
  sequelize.query(
    `SELECT s.id, s.name, COUNT(q.id)::int AS question_count
       FROM subjects s
       JOIN questions q ON q.subject_id = s.id
      WHERE s.is_active = true
        AND s.exam_domain IS NULL
        AND q.is_active = true
        AND q.source_type IN (:sourceTypes)
      GROUP BY s.id, s.name
      ORDER BY question_count DESC, s.name`,
    { replacements: { sourceTypes: SOURCE_TYPES }, type: QueryTypes.SELECT }
  );

/** Largest-remainder rounding, so the domain counts always add up to the paper size. */
const getDomainCounts = (questionCount) => {
  const exact = EXAM_DOMAINS.map((d) => d.weight * questionCount);
  const counts = exact.map(Math.floor);
  let leftover = questionCount - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (leftover-- <= 0) break;
    counts[index]++;
  }
  return counts;
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
 * Orders questions so any prefix holds each subject in proportion to its size:
 * each question's key is (its rank within its subject + jitter) / subject size,
 * and sorting by that key interleaves the subjects evenly. Without this, a big
 * subject like Psychiatry would crowd the small ones out of a paper.
 */
const orderProportionally = (questions) => {
  const keyed = [];
  for (const group of Map.groupBy(questions, (q) => q.subject_id).values()) {
    shuffle(group).forEach((q, rank) => keyed.push({ q, key: (rank + Math.random()) / group.length }));
  }
  return keyed.sort((a, b) => a.key - b.key).map((k) => k.q);
};

/**
 * Least-used questions first: never-used ones, then those in one mock, and so
 * on — so repeats only appear once a domain has run out of fresh questions.
 */
const pickForDomain = (questions, count) => {
  const byUsage = Map.groupBy(questions, (q) => q.times_used);
  const picked = [];
  for (const timesUsed of [...byUsage.keys()].sort((a, b) => a - b)) {
    if (picked.length >= count) break;
    picked.push(...orderProportionally(byUsage.get(timesUsed)).slice(0, count - picked.length));
  }
  return picked;
};

const parseQuestionCount = (value) => {
  const count = Number(value ?? 150);
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    throw new AppError(`Number of questions must be a whole number between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}`, 400);
  }
  return count;
};

/**
 * What a weighted mock of this size would draw on: per domain, how many
 * questions it needs and how many unused ones are left, plus how many more
 * mocks can be built before any question repeats.
 */
export const getWeightedMockPreview = async (questionCountInput) => {
  const questionCount = parseQuestionCount(questionCountInput);
  const [pool, unassignedSubjects] = await Promise.all([loadPool(), loadUnassignedSubjects()]);
  const counts = getDomainCounts(questionCount);

  const domains = EXAM_DOMAINS.map((domain, i) => {
    const domainPool = pool.filter((q) => q.exam_domain === domain.key);
    const unusedAvailable = domainPool.filter((q) => q.times_used === 0).length;
    return {
      key: domain.key,
      label: domain.label,
      weight: domain.weight,
      per_mock: counts[i],
      unused_available: unusedAvailable,
      total_available: domainPool.length,
    };
  });

  return {
    question_count: questionCount,
    domains,
    mocks_without_repeats: Math.min(...domains.map((d) => Math.floor(d.unused_available / d.per_mock))),
    unassigned_subjects: unassignedSubjects,
  };
};

/**
 * Builds one FIXED, unpublished mock in the client's AMC weightage. Every
 * student who sits it gets the same paper, and it avoids questions already used
 * in other mocks for as long as unused ones remain.
 */
export const createWeightedMock = async ({ title, question_count, duration_minutes }) => {
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  if (!trimmedTitle) throw new AppError('Title is required', 400);
  if (trimmedTitle.length > 255) throw new AppError('Title is too long', 400);

  const questionCount = parseQuestionCount(question_count);
  const durationMinutes = Number(duration_minutes ?? 210);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_DURATION_MINUTES) {
    throw new AppError(`Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MINUTES}`, 400);
  }

  const duplicate = await MockTest.findOne({ where: where(fn('lower', col('title')), trimmedTitle.toLowerCase()) });
  if (duplicate) throw new AppError(`A mock test called "${duplicate.title}" already exists`, 400);

  const [pool, unassignedSubjects] = await Promise.all([loadPool(), loadUnassignedSubjects()]);
  const counts = getDomainCounts(questionCount);

  const paper = [];
  const domains = EXAM_DOMAINS.map((domain, i) => {
    const domainPool = pool.filter((q) => q.exam_domain === domain.key);
    if (domainPool.length < counts[i]) {
      throw new AppError(
        `Not enough questions in ${domain.label}: this mock needs ${counts[i]}, only ${domainPool.length} are available. ` +
        'Import more questions or assign more subjects to this domain.',
        400
      );
    }
    const picked = pickForDomain(domainPool, counts[i]);
    paper.push(...picked);
    return {
      key: domain.key,
      label: domain.label,
      count: picked.length,
      repeats: picked.filter((q) => q.times_used > 0).length,
    };
  });

  const orderedPaper = shuffle(paper);
  const blueprint = EXAM_DOMAINS.map((d, i) => ({ domain: d.label, weight: d.weight, count: counts[i] }));

  const mockTest = await sequelize.transaction(async (t) => {
    const created = await MockTest.create({
      title: trimmedTitle,
      description: 'AMC-weighted mock: Medicine 30%, Surgery 20%, Women\'s, Child, Mental, Population Health & Ethics 12.5% each.',
      duration_minutes: durationMinutes,
      total_questions: orderedPaper.length,
      total_marks: orderedPaper.reduce((sum, q) => sum + (q.marks ?? 1), 0),
      test_type: 'fixed',
      is_published: false,
      // Its own key: the admin UI reads `subjects`/`difficulty` from this column.
      configuration_json: { blueprint },
    }, { transaction: t });

    await MockTestQuestion.bulkCreate(
      orderedPaper.map((q, order) => ({ mock_test_id: created.id, question_id: q.id, question_order: order + 1 })),
      { transaction: t }
    );
    return created;
  });

  return {
    mock_test: mockTest,
    domains,
    total_repeats: domains.reduce((sum, d) => sum + d.repeats, 0),
    unassigned_subjects: unassignedSubjects,
  };
};
