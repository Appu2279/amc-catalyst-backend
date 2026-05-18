import { sequelize, ImportBatch, Question, QuestionOption } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

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

  await batch.update({
    status: status === 'failed' ? 'failed' : 'completed',
    total_questions: total_questions || 0,
    failed_questions: failed_questions || 0,
    import_logs: { questions, logs },
  });
  return { message: 'Parsed data received', batch_id: batch.id };
};

export const approveBatch = async (id, approvedBy) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Batch not found', 404);
  if (batch.status !== 'completed') throw new AppError(`Batch is not ready for approval (status: ${batch.status})`, 400);

  const parsedQuestions = batch.import_logs?.questions;
  if (!parsedQuestions?.length) throw new AppError('No parsed questions found in this batch', 400);

  const t = await sequelize.transaction();
  try {
    let imported = 0, failed = 0;

    for (const q of parsedQuestions) {
      try {
        const question = await Question.create(
          { subject_id: q.subject_id, topic_id: q.topic_id || null, question_text: q.question_text,
            explanation: q.explanation || null, difficulty: q.difficulty || 'medium',
            question_type: q.question_type || 'single_choice', source_type: q.source_type || 'qbank',
            source_year: q.source_year || null, marks: q.marks || 1, negative_marks: q.negative_marks || 0,
            import_batch_id: batch.id, created_by: approvedBy },
          { transaction: t }
        );
        await QuestionOption.bulkCreate(
          (q.options || []).map((o) => ({ question_id: question.id, option_key: o.option_key, option_text: o.option_text, is_correct: o.is_correct || false })),
          { transaction: t }
        );
        imported++;
      } catch { failed++; }
    }

    await batch.update({ imported_questions: imported, failed_questions: failed }, { transaction: t });
    await t.commit();
    return { message: 'Batch approved', imported, failed };
  } catch (err) {
    await t.rollback();
    throw err;
  }
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
