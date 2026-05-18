import { sequelize, MockTest, MockTestQuestion, Question, QuestionOption, UserMockAttempt, AttemptQuestion, UserAnswer } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const listPublishedTests = () =>
  MockTest.findAll({
    where: { is_published: true },
    attributes: { exclude: ['configuration_json'] },
    order: [['created_at', 'DESC']],
  });

export const getTestInfo = async (id) => {
  const test = await MockTest.findOne({ where: { id, is_published: true } });
  if (!test) throw new AppError('Test not found', 404);
  return test;
};

export const startAttempt = async (userId, testId) => {
  const test = await MockTest.findOne({ where: { id: testId, is_published: true } });
  if (!test) throw new AppError('Test not found', 404);

  const existing = await UserMockAttempt.findOne({
    where: { user_id: userId, mock_test_id: test.id, status: 'in_progress' },
  });
  if (existing) throw new AppError('You already have an ongoing attempt', 400, { attempt_id: existing.id });

  const t = await sequelize.transaction();
  try {
    const attempt = await UserMockAttempt.create(
      { user_id: userId, mock_test_id: test.id, started_at: new Date() },
      { transaction: t }
    );

    let questionIds = [];
    if (test.test_type === 'fixed') {
      const mqList = await MockTestQuestion.findAll({
        where: { mock_test_id: test.id }, order: [['question_order', 'ASC']],
      });
      questionIds = mqList.map((mq) => mq.question_id);
      if (test.randomize_questions) questionIds = questionIds.sort(() => Math.random() - 0.5);
    } else {
      questionIds = await generateDynamicQuestions(test.configuration_json);
    }

    if (!questionIds.length) {
      await t.rollback();
      throw new AppError('No questions available for this test', 400);
    }

    await AttemptQuestion.bulkCreate(
      questionIds.map((qid, idx) => ({ attempt_id: attempt.id, question_id: qid, question_order: idx + 1 })),
      { transaction: t }
    );
    await t.commit();
    return { attempt_id: attempt.id, total_questions: questionIds.length };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export const getAttempt = async (attemptId, userId) => {
  const attempt = await UserMockAttempt.findOne({
    where: { id: attemptId, user_id: userId },
    include: [{
      model: AttemptQuestion, as: 'attempt_questions',
      include: [{ model: Question, as: 'question', include: [{ model: QuestionOption }] }],
      order: [['question_order', 'ASC']],
    }],
  });
  if (!attempt) throw new AppError('Attempt not found', 404);

  const result = attempt.toJSON();

  if (attempt.status === 'in_progress') {
    result.attempt_questions = result.attempt_questions.map((aq) => ({
      ...aq,
      question: {
        ...aq.question,
        QuestionOptions: aq.question?.QuestionOptions?.map(({ is_correct: _, ...opt }) => opt),
      },
    }));
  }

  result.answers = await UserAnswer.findAll({ where: { attempt_id: attempt.id } });
  return result;
};

export const submitAnswer = async (attemptId, userId, { question_id, selected_option_id }) => {
  const attempt = await UserMockAttempt.findOne({
    where: { id: attemptId, user_id: userId, status: 'in_progress' },
  });
  if (!attempt) throw new AppError('Active attempt not found', 404);

  const inAttempt = await AttemptQuestion.findOne({ where: { attempt_id: attempt.id, question_id } });
  if (!inAttempt) throw new AppError('Question not part of this attempt', 400);

  const [answer, created] = await UserAnswer.findOrCreate({
    where: { attempt_id: attempt.id, question_id },
    defaults: { selected_option_id, answered_at: new Date() },
  });

  if (!created) await answer.update({ selected_option_id, answered_at: new Date() });
  return { message: created ? 'Answer saved' : 'Answer updated' };
};

export const submitAttempt = async (attemptId, userId) => {
  const attempt = await UserMockAttempt.findOne({
    where: { id: attemptId, user_id: userId, status: 'in_progress' },
  });
  if (!attempt) throw new AppError('Active attempt not found', 404);

  const t = await sequelize.transaction();
  try {
    const attemptQuestions = await AttemptQuestion.findAll({
      where: { attempt_id: attempt.id },
      include: [{ model: Question, as: 'question' }],
    });

    const userAnswers = await UserAnswer.findAll({ where: { attempt_id: attempt.id } });
    const answerMap = new Map(userAnswers.map((a) => [a.question_id, a]));
    const correctOptionMap = await buildCorrectOptionMap(attemptQuestions.map((aq) => aq.question_id));

    let score = 0, total_correct = 0, total_wrong = 0, total_unanswered = 0;
    const updates = [];

    for (const aq of attemptQuestions) {
      const answer = answerMap.get(aq.question.id);
      if (!answer) { total_unanswered++; continue; }

      const is_correct = answer.selected_option_id === correctOptionMap.get(aq.question.id);
      if (is_correct) { score += aq.question.marks; total_correct++; }
      else { score -= aq.question.negative_marks; total_wrong++; }

      updates.push(answer.update({ is_correct }, { transaction: t }));
    }

    await Promise.all(updates);
    const completed_at = new Date();
    await attempt.update(
      { status: 'completed', score, total_correct, total_wrong, total_unanswered,
        completed_at, time_taken_seconds: Math.floor((completed_at - attempt.started_at) / 1000) },
      { transaction: t }
    );

    await t.commit();
    return { message: 'Test submitted', score, total_correct, total_wrong, total_unanswered };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export const getResult = async (attemptId, userId) => {
  const attempt = await UserMockAttempt.findOne({
    where: { id: attemptId, user_id: userId, status: 'completed' },
    include: [{
      model: AttemptQuestion, as: 'attempt_questions',
      include: [{ model: Question, as: 'question', include: [{ model: QuestionOption }] }],
      order: [['question_order', 'ASC']],
    }],
  });
  if (!attempt) throw new AppError('Completed attempt not found', 404);

  const answers = await UserAnswer.findAll({
    where: { attempt_id: attempt.id },
    include: [{ model: QuestionOption, as: 'selected_option' }],
  });

  const answerMap = new Map(answers.map((a) => [a.question_id, a]));
  const result = attempt.toJSON();
  result.attempt_questions = result.attempt_questions.map((aq) => ({
    ...aq,
    user_answer: answerMap.get(aq.question_id) || null,
  }));
  return result;
};

// ── Helpers ──────────────────────────────────────
async function generateDynamicQuestions(config) {
  const { subjects, difficulty } = config;
  const allIds = [];

  for (const { subject_id, count } of subjects) {
    const baseWhere = { subject_id, is_active: true };

    if (difficulty) {
      const { easy, medium, hard } = computeDifficultyBreakdown(count, difficulty);
      for (const [diff, diffCount] of Object.entries({ easy, medium, hard })) {
        if (diffCount <= 0) continue;
        const qs = await Question.findAll({
          where: { ...baseWhere, difficulty: diff },
          order: sequelize.literal('RANDOM()'),
          limit: diffCount,
          attributes: ['id'],
        });
        allIds.push(...qs.map((q) => q.id));
      }
    } else {
      const qs = await Question.findAll({
        where: baseWhere, order: sequelize.literal('RANDOM()'), limit: count, attributes: ['id'],
      });
      allIds.push(...qs.map((q) => q.id));
    }
  }
  return allIds;
}

function computeDifficultyBreakdown(total, difficulty) {
  const easy = Math.floor(total * (difficulty.easy || 0) / 100);
  const hard = Math.floor(total * (difficulty.hard || 0) / 100);
  return { easy, medium: total - easy - hard, hard };
}

async function buildCorrectOptionMap(questionIds) {
  const opts = await QuestionOption.findAll({
    where: { question_id: questionIds, is_correct: true },
    attributes: ['id', 'question_id'],
  });
  return new Map(opts.map((o) => [o.question_id, o.id]));
}
