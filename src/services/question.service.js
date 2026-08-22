import { Op } from 'sequelize';
import { sequelize, Question, QuestionOption, Subject, Topic, QuestionProgress, ImportBatch } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const buildWhere = (query) => {
  const { subject_id, topic_id, difficulty, question_type, source_type, search, is_active, import_batch_id } = query;
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
 * A where-fragment that removes questions belonging to hidden import batches.
 *
 * An import batch is the student-facing grouping for recalls — one upload is
 * one month ("August Recall 2026"), and hiding it must take its questions out
 * of practice everywhere: lists, single fetches, answer checks and progress.
 *
 * Implemented by looking the hidden ids up first rather than joining and
 * filtering on `$import_batch.is_visible$`. The question list includes a
 * hasMany association, so Sequelize wraps the query in a limit subquery that
 * the joined table is not part of, and a where against it fails at runtime.
 * There are only ever a handful of batches, so the extra query is free.
 *
 * Questions with no batch (created by hand in the admin) are always visible —
 * they have no batch to hide, and excluding them would make them silently
 * vanish.
 */
const excludeHiddenBatches = async () => {
  const hidden = await ImportBatch.findAll({
    where: { is_visible: false },
    attributes: ['id'],
  });

  if (!hidden.length) return {};

  return {
    [Op.or]: [
      { import_batch_id: null },
      { import_batch_id: { [Op.notIn]: hidden.map((b) => b.id) } },
    ],
  };
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

// ── Student ───────────────────────────────────────
// The explanation is the teaching content students pay for — it is revealed one
// question at a time by /check, never in a list a scraper can page through.
const STUDENT_QUESTION_ATTRIBUTES = { exclude: ['explanation', 'created_by', 'import_batch_id'] };

export const listQuestions = async (query) => {
  const where = { ...buildWhere(query), is_active: true, ...(await excludeHiddenBatches()) };
  const { limit, offset, page } = paginate(query);
  const { count, rows } = await Question.findAndCountAll({
    where, attributes: STUDENT_QUESTION_ATTRIBUTES,
    include: subjectTopicIncludes(false), limit, offset,
    order: [['id', 'ASC']], distinct: true,
  });
  return { data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
};

export const getQuestion = async (id) => {
  const q = await Question.findOne({
    // Hidden batches are excluded here too, not just in the list: otherwise a
    // student who kept a question id could still fetch it after the batch was
    // hidden.
    where: { id, is_active: true, ...(await excludeHiddenBatches()) },
    attributes: STUDENT_QUESTION_ATTRIBUTES,
    include: subjectTopicIncludes(false),
  });
  if (!q) throw new AppError('Question not found', 404);
  return q;
};

// Called after the student picks an option — returns correct flag + full option details
export const checkAnswer = async (questionId, selectedOptionId, userId) => {
  const q = await Question.findOne({
    where: { id: questionId, is_active: true, ...(await excludeHiddenBatches()) },
    include: [{ model: QuestionOption, as: 'options' }],
  });
  if (!q) throw new AppError('Question not found', 404);

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
const recordAnswer = async ({ userId, questionId, selectedOptionId, isCorrect }) => {
  const [row, created] = await QuestionProgress.findOrCreate({
    where: { user_id: userId, question_id: questionId },
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
export const getPracticeProgress = async (userId, { source_type, import_batch_id } = {}) => {
  const rows = await QuestionProgress.findAll({
    where: { user_id: userId },
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
          ...(await excludeHiddenBatches()),
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
export const resetPracticeProgress = async (userId, { source_type, import_batch_id } = {}) => {
  if (!source_type) throw new AppError('source_type is required', 400);

  const questions = await Question.findAll({
    // Scoped to a batch when given, so starting over on July's recall does not
    // also wipe the student's progress through August.
    where: { source_type, ...(import_batch_id ? { import_batch_id } : {}) },
    attributes: ['id'],
  });

  if (!questions.length) return { cleared: 0 };

  const cleared = await QuestionProgress.destroy({
    where: {
      user_id: userId,
      question_id: { [Op.in]: questions.map((q) => q.id) },
    },
  });

  return { cleared };
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
export const listQuestionBatches = async ({ source_type } = {}, userId) => {
  const rows = await Question.findAll({
    attributes: [
      'import_batch_id',
      [sequelize.fn('COUNT', sequelize.col('Question.id')), 'question_count'],
    ],
    where: {
      is_active: true,
      ...(source_type ? { source_type } : {}),
      ...(await excludeHiddenBatches()),
    },
    include: [
      {
        model: ImportBatch,
        as: 'import_batch',
        attributes: ['id', 'title', 'createdAt'],
        required: false,
      },
    ],
    group: ['Question.import_batch_id', 'import_batch.id'],
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
      where: { user_id: userId },
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
      title: r.import_batch?.title ?? 'Other questions',
      question_count: Number(r.question_count),
      answered_count: answeredByBatch.get(r.import_batch_id) ?? 0,
      created_at: r.import_batch?.createdAt ?? null,
    }))
    // Newest batch first — that is the one students want by default. Unbatched
    // questions have no date, so they sort last.
    .sort((a, b) => {
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
};

/**
 * Show or hide a batch for students. Admin only.
 *
 * Nothing is deleted: hiding is reversible, which is the point — a batch put up
 * for a demo can be taken down and restored later.
 */
export const setBatchVisibility = async (id, isVisible) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Import batch not found', 404);

  await batch.update({ is_visible: Boolean(isVisible) });
  return { id: batch.id, title: batch.title, is_visible: batch.is_visible };
};
