import { sequelize, ImportBatch, Question, QuestionOption, Subject, Topic } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const DIFFICULTY_MAP = {
  easy: 'easy', Easy: 'easy', EASY: 'easy',
  medium: 'medium', Medium: 'medium', MEDIUM: 'medium',
  moderate: 'medium', Moderate: 'medium', MODERATE: 'medium',
  hard: 'hard', Hard: 'hard', HARD: 'hard',
};

const normalizeDifficulty = (val) => DIFFICULTY_MAP[val] ?? 'medium';

const toSlug = (name) => name.toLowerCase().trim().replace(/\s+/g, '-');

const findOrCreateSubject = async (q, t) => {
  if (q.subject_id) {
    const s = await Subject.findByPk(q.subject_id, { transaction: t });
    if (s) return s.id;
  }
  if (!q.subject) return null;
  const [subject] = await Subject.findOrCreate({
    where: { name: q.subject },
    defaults: { slug: toSlug(q.subject) },
    transaction: t,
  });
  return subject.id;
};

const findOrCreateTopic = async (q, subjectId, t) => {
  if (q.topic_id) {
    const top = await Topic.findByPk(q.topic_id, { transaction: t });
    if (top) return top.id;
  }
  if (!q.topic || !subjectId) return null;
  const [topic] = await Topic.findOrCreate({
    where: { name: q.topic, subject_id: subjectId },
    defaults: { slug: toSlug(q.topic) },
    transaction: t,
  });
  return topic.id;
};

const buildOptions = (q) => {
  if (Array.isArray(q.options)) {
    return q.options.map((o) => ({
      option_key: o.option_key,
      option_text: o.option_text,
      option_image: o.option_image || null,
      is_correct: o.is_correct || false,
      explanation: o.explanation || (q.option_explanations?.[o.option_key]) || null,
    }));
  }
  if (q.options && typeof q.options === 'object') {
    return Object.entries(q.options).map(([key, text]) => ({
      option_key: key,
      option_text: text,
      option_image: null,
      is_correct: q.correct_answer === key,
      explanation: q.option_explanations?.[key] || null,
    }));
  }
  return [];
};

export const listBatches = () =>
  ImportBatch.findAll({ attributes: { exclude: ['import_logs'] }, order: [['created_at', 'DESC']] });

export const getBatch = async (id) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Batch not found', 404);
  return batch;
};

export const createBatch = async ({ title, questions_pdf, answers_pdf }) => {
  const batch = await ImportBatch.create({ title, questions_pdf, answers_pdf, status: 'processing' });

  const pythonUrl = process.env.PYTHON_SERVICE_URL;
  if (pythonUrl) {
    fetch(`${pythonUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: batch.id, questions_pdf, answers_pdf }),
    }).catch(() => {});
  }

  return {
    batch_id: batch.id,
    message: pythonUrl ? 'Batch created and sent to processing' : 'Batch created. Trigger Python manually with this batch_id.',
  };
};

export const receiveParsed = async (id, { status, total_questions, failed_questions, questions, logs }) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Batch not found', 404);

  if (status === 'failed' || !questions?.length) {
    await batch.update({
      status: 'failed',
      total_questions: total_questions || 0,
      failed_questions: failed_questions || 0,
      import_logs: { logs },
    });
    return { message: 'Batch marked as failed', batch_id: batch.id };
  }

  let imported = 0, failed = 0;
  const failedDetails = [];

  for (const q of questions) {
    const t = await sequelize.transaction();
    try {
      const subjectId = await findOrCreateSubject(q, t);
      if (!subjectId) throw new Error(`Subject not provided: "${q.subject ?? q.subject_id}"`);

      const topicId = await findOrCreateTopic(q, subjectId, t);

      const imagesList = Array.isArray(q.images) ? q.images.filter(Boolean) : [];
      const answerImagesList = Array.isArray(q.answer_images) ? q.answer_images.filter(Boolean) : [];
      const questionType = q.question_type || (q.image_present || imagesList.length ? 'image_based' : 'single_choice');

      const question = await Question.create(
        {
          subject_id: subjectId,
          topic_id: topicId,
          question_number: q.question_number || null,
          question_text: q.question_text,
          explanation: q.explanation || null,
          difficulty: normalizeDifficulty(q.difficulty),
          question_type: questionType,
          source_type: q.source_type || 'recall',
          source_year: q.source_year || null,
          marks: q.marks ?? 1,
          negative_marks: q.negative_marks ?? 0,
          question_image: imagesList[0] || null,
          question_images: imagesList.length ? imagesList : null,
          answer_images: answerImagesList.length ? answerImagesList : null,
          image_type: q.image_type || null,
          page_number: q.page_number || null,
          import_batch_id: batch.id,
        },
        { transaction: t }
      );

      const options = buildOptions(q);
      if (options.length) {
        await QuestionOption.bulkCreate(
          options.map((o) => ({ ...o, question_id: question.id })),
          { transaction: t }
        );
      }

      await t.commit();
      imported++;
    } catch (err) {
      await t.rollback();
      failed++;
      failedDetails.push({ question_number: q.question_number, error: err.message });
    }
  }

  await batch.update({
    status: 'completed',
    total_questions: total_questions || imported + failed,
    imported_questions: imported,
    failed_questions: failed,
    import_logs: { logs, failed_details: failedDetails.length ? failedDetails : undefined },
  });

  return { message: 'Questions imported successfully', batch_id: batch.id, imported, failed, failed_details: failedDetails };
};

export const approveBatch = async (id) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Batch not found', 404);
  if (batch.status !== 'completed') throw new AppError(`Batch is not ready for approval (status: ${batch.status})`, 400);

  return {
    message: 'Batch approved',
    batch_id: batch.id,
    imported_questions: batch.imported_questions,
    failed_questions: batch.failed_questions,
  };
};

export const rollbackBatch = async (id) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Batch not found', 404);

  const t = await sequelize.transaction();
  try {
    await Question.destroy({ where: { import_batch_id: id }, transaction: t });
    await batch.destroy({ transaction: t });
    await t.commit();
    return { message: 'Batch and all its questions have been rolled back' };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};
