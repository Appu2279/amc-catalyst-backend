import { Op } from 'sequelize';
import { sequelize, Question, QuestionOption, Subject, Topic } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const buildWhere = (query) => {
  const { subject_id, topic_id, difficulty, question_type, source_type, search, is_active } = query;
  const where = {};
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
  const limit = Math.min(100, parseInt(query.limit) || 20);
  return { limit, offset: (page - 1) * limit, page };
};

const subjectTopicIncludes = (withCorrect) => [
  { model: QuestionOption, attributes: withCorrect ? undefined : ['id', 'option_key', 'option_text'] },
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
    source_type, source_year, marks, negative_marks, options } = data;

  const t = await sequelize.transaction();
  try {
    await question.update(
      { subject_id, topic_id, question_text, explanation, difficulty, question_type,
        source_type, source_year, marks, negative_marks },
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
export const listQuestions = async (query) => {
  const where = { ...buildWhere(query), is_active: true };
  const { limit, offset, page } = paginate(query);
  const { count, rows } = await Question.findAndCountAll({
    where, include: subjectTopicIncludes(false), limit, offset,
    order: [['id', 'ASC']], distinct: true,
  });
  return { data: rows, pagination: { total: count, page, limit, pages: Math.ceil(count / limit) } };
};

export const getQuestion = async (id) => {
  const q = await Question.findOne({
    where: { id, is_active: true },
    include: subjectTopicIncludes(false),
  });
  if (!q) throw new AppError('Question not found', 404);
  return q;
};
