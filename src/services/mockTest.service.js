import { QueryTypes } from 'sequelize';
import { sequelize, MockTest, MockTestQuestion, Question, QuestionOption } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const createMockTest = async (data) => {
  const { title, description, duration_minutes, total_marks, test_type,
    randomize_questions, randomize_options, configuration_json, starts_at, ends_at } = data;

  if (test_type === 'dynamic' && !configuration_json) {
    throw new AppError('configuration_json is required for dynamic tests', 400);
  }

  const total_questions = test_type === 'dynamic' && configuration_json?.subjects
    ? configuration_json.subjects.reduce((sum, s) => sum + (s.count || 0), 0)
    : 0;

  return MockTest.create({
    title, description, duration_minutes, total_marks,
    test_type: test_type || 'fixed',
    randomize_questions: randomize_questions || false,
    randomize_options: randomize_options || false,
    configuration_json: configuration_json || null,
    total_questions, starts_at, ends_at,
  });
};

export const listMockTests = () =>
  MockTest.findAll({ order: [['created_at', 'DESC']] });

export const getMockTest = async (id) => {
  const test = await MockTest.findByPk(id);
  if (!test) throw new AppError('Mock test not found', 404);

  const result = test.toJSON();
  if (test.test_type === 'fixed') {
    result.questions = await MockTestQuestion.findAll({
      where: { mock_test_id: id },
      include: [{ model: Question, as: 'question', include: [{ model: QuestionOption, as: 'options' }] }],
      order: [['question_order', 'ASC']],
    });
  }
  return result;
};

export const updateMockTest = async (id, data) => {
  const test = await MockTest.findByPk(id);
  if (!test) throw new AppError('Mock test not found', 404);

  const { title, description, duration_minutes, total_marks,
    randomize_questions, randomize_options, configuration_json, starts_at, ends_at } = data;

  let total_questions = test.total_questions;
  if (test.test_type === 'dynamic' && configuration_json?.subjects) {
    total_questions = configuration_json.subjects.reduce((sum, s) => sum + (s.count || 0), 0);
  }

  await test.update({ title, description, duration_minutes, total_marks,
    randomize_questions, randomize_options, configuration_json, total_questions, starts_at, ends_at });
  return test;
};

export const deleteMockTest = async (id) => {
  const test = await MockTest.findByPk(id);
  if (!test) throw new AppError('Mock test not found', 404);
  await test.destroy();
  return { message: 'Deleted successfully' };
};

export const togglePublish = async (id) => {
  const test = await MockTest.findByPk(id);
  if (!test) throw new AppError('Mock test not found', 404);
  await test.update({ is_published: !test.is_published });
  return { is_published: test.is_published };
};

/** Marks a whole mock exam as a free sample, or takes it back. */
export const toggleFree = async (id) => {
  const test = await MockTest.findByPk(id);
  if (!test) throw new AppError('Mock test not found', 404);
  await test.update({ is_free: !test.is_free });
  return { is_free: test.is_free };
};

export const addQuestions = async (testId, questions) => {
  const test = await MockTest.findByPk(testId);
  if (!test) throw new AppError('Mock test not found', 404);
  if (test.test_type !== 'fixed') throw new AppError('Cannot add questions to a dynamic test', 400);
  if (!questions?.length) throw new AppError('questions array is required', 400);

  await MockTestQuestion.bulkCreate(
    questions.map((q) => ({ mock_test_id: testId, question_id: q.question_id, question_order: q.question_order })),
    { ignoreDuplicates: true }
  );

  const count = await MockTestQuestion.count({ where: { mock_test_id: testId } });
  await test.update({ total_questions: count });
  return { message: 'Questions added', count: questions.length };
};

export const getQuestionPool = async () =>
  sequelize.query(
    `SELECT
       s.id::text          AS subject_id,
       s.name              AS subject_name,
       COUNT(q.id)::int    AS total,
       SUM(CASE WHEN q.difficulty = 'easy'   THEN 1 ELSE 0 END)::int AS easy,
       SUM(CASE WHEN q.difficulty = 'medium' THEN 1 ELSE 0 END)::int AS medium,
       SUM(CASE WHEN q.difficulty = 'hard'   THEN 1 ELSE 0 END)::int AS hard,
       SUM(CASE WHEN q.difficulty IS NULL     THEN 1 ELSE 0 END)::int AS unset
     FROM subjects s
     LEFT JOIN questions q ON q.subject_id = s.id AND q.is_active = true
     GROUP BY s.id, s.name
     ORDER BY s.name`,
    { type: QueryTypes.SELECT }
  );

export const removeQuestion = async (testId, questionId) => {
  const deleted = await MockTestQuestion.destroy({ where: { mock_test_id: testId, question_id: questionId } });
  if (!deleted) throw new AppError('Question not found in this test', 404);

  const test = await MockTest.findByPk(testId);
  await test.update({ total_questions: await MockTestQuestion.count({ where: { mock_test_id: testId } }) });
  return { message: 'Question removed' };
};
