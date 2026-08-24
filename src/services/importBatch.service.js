import { sequelize, ImportBatch, Question, QuestionOption, Subject, Topic } from '../models/index.js';
import { Op } from 'sequelize';
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

  // Include the imported questions with options + subject for the preview panel
  const questions = await Question.findAll({
    where: { import_batch_id: id },
    include: [
      { model: QuestionOption, as: 'options' },
      { model: Subject, as: 'subject', attributes: ['id', 'name'] },
      { model: Topic,   as: 'topic',   attributes: ['id', 'name'] },
    ],
    order: [['question_number', 'ASC'], ['id', 'ASC']],
  });

  return { ...batch.toJSON(), questions };
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
      const subjectId = await findOrCreateSubject(q, t); // may be null — admin can assign later
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

/**
 * Batch membership is one column on the question (`import_batch_id`), so moving
 * a question in or out of a batch never touches the question, its options or
 * anyone's progress on it. Removing a question from a batch unassigns it; it
 * stays in the question bank and can be put in another batch afterwards.
 * Deleting a question outright stays where it belongs, on the questions page.
 */

/**
 * `imported_questions` is what the admin table reads as the size of a batch, so
 * it tracks membership rather than staying frozen at whatever the parser
 * reported. `total_questions` is left alone: that is the parse result and a
 * record of the import run.
 */
const syncImportedCount = async (batchId) => {
  const imported = await Question.count({ where: { import_batch_id: batchId } });
  await ImportBatch.update({ imported_questions: imported }, { where: { id: batchId } });
  return imported;
};

/**
 * The pool the "add to batch" picker draws from: questions that belong to no
 * batch at all. A question already in a batch is deliberately not offered —
 * moving it would silently shrink the batch it came from, so it has to be
 * removed there first.
 *
 * Capped, with an optional text search, because the pool grows with every
 * hand-written question and the picker only ever shows a screenful.
 */
export const listUnassignedQuestions = async ({ search } = {}) => {
  const where = { import_batch_id: null };
  const term = search?.trim();
  if (term) where.question_text = { [Op.iLike]: `%${term}%` };

  return Question.findAll({
    where,
    include: [
      { model: QuestionOption, as: 'options' },
      { model: Subject, as: 'subject', attributes: ['id', 'name'] },
      { model: Topic,   as: 'topic',   attributes: ['id', 'name'] },
    ],
    order: [['id', 'DESC']],
    limit: 200,
  });
};

export const removeQuestionFromBatch = async (batchId, questionId) => {
  const question = await Question.findByPk(questionId);
  if (!question) throw new AppError('Question not found', 404);
  if (String(question.import_batch_id) !== String(batchId)) {
    throw new AppError('Question does not belong to this batch', 400);
  }

  await question.update({ import_batch_id: null });

  return {
    message: 'Question removed from batch',
    question_id: question.id,
    imported_questions: await syncImportedCount(batchId),
  };
};

export const addQuestionsToBatch = async (batchId, questionIds) => {
  const batch = await ImportBatch.findByPk(batchId);
  if (!batch) throw new AppError('Batch not found', 404);

  const ids = [...new Set((questionIds ?? []).map(Number).filter(Boolean))];
  if (!ids.length) throw new AppError('No questions selected', 400);

  // `import_batch_id: null` in the WHERE, rather than a read-then-write: a
  // question that has been claimed by another batch in the meantime is skipped
  // instead of quietly taken from it.
  const [added] = await Question.update(
    { import_batch_id: batch.id },
    { where: { id: { [Op.in]: ids }, import_batch_id: null } }
  );

  const skipped = ids.length - added;
  return {
    message: skipped
      ? `${added} of ${ids.length} added — the rest already belong to a batch`
      : 'Questions added to batch',
    added,
    skipped,
    imported_questions: await syncImportedCount(batch.id),
  };
};

export const approveBatch = async (id) => {
  const batch = await ImportBatch.findByPk(id);
  if (!batch) throw new AppError('Batch not found', 404);
  if (batch.status !== 'completed') throw new AppError(`Batch is not ready for approval (status: ${batch.status})`, 400);

  await batch.update({ status: 'approved' });

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
