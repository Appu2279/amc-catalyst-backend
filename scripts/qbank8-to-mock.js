/**
 * One-off: repurpose import batch 8 (imported as qbank by mistake) into two
 * 100-question mock tests. No re-extraction — the questions already hold every
 * stem, option, correct flag and explanation.
 *
 *   node scripts/qbank8-to-mock.js
 *
 * - Orders the 207 questions by question_number, drops the last 7 → 200.
 * - source_type qbank -> mock, import_batch_id -> null (mock pool questions
 *   carry no batch).
 * - Deletes the now-empty batch 8.
 * - Creates "AMC Free 209 MCQ — Paper 1" (q 1–100) and "— Paper 2" (q 101–200),
 *   fixed, 140 min, 100 marks, UNPUBLISHED. Publish + set free/paid in the admin
 *   panel.
 */
import {
  sequelize, Question, QuestionOption, ImportBatch, MockTest, MockTestQuestion,
} from '../src/models/index.js';

const BATCH_ID = 8;
const DURATION_MIN = 140;
const PAPERS = [
  { title: 'AMC Free 209 MCQ — Paper 1', from: 0,   to: 100 },
  { title: 'AMC Free 209 MCQ — Paper 2', from: 100, to: 200 },
];

const run = async () => {
  const batch = await ImportBatch.findByPk(BATCH_ID);
  if (!batch) throw new Error(`Import batch ${BATCH_ID} not found`);

  const questions = await Question.findAll({
    where: { import_batch_id: BATCH_ID },
    order: [['question_number', 'ASC'], ['id', 'ASC']],
    attributes: ['id', 'question_number'],
  });
  console.log(`Batch ${BATCH_ID}: ${questions.length} questions`);
  if (questions.length < 200) throw new Error('Expected at least 200 questions to split 100/100');

  const keep = questions.slice(0, 200);
  const drop = questions.slice(200);
  console.log(`Keeping first 200, dropping last ${drop.length} (q# ${drop.map((q) => q.question_number).join(', ')})`);

  const t = await sequelize.transaction();
  try {
    // Drop the tail.
    const dropIds = drop.map((q) => q.id);
    if (dropIds.length) {
      await QuestionOption.destroy({ where: { question_id: dropIds }, transaction: t });
      await Question.destroy({ where: { id: dropIds }, transaction: t });
    }

    // Repurpose the 200.
    const keepIds = keep.map((q) => q.id);
    await Question.update(
      { source_type: 'mock', import_batch_id: null },
      { where: { id: keepIds }, transaction: t }
    );

    // The batch is empty now.
    await batch.destroy({ transaction: t });

    // Build the two papers.
    for (const paper of PAPERS) {
      const slice = keep.slice(paper.from, paper.to);
      const test = await MockTest.create({
        title: paper.title,
        description: 'Imported from the AMC Free 209 MCQ set.',
        duration_minutes: DURATION_MIN,
        total_questions: slice.length,
        total_marks: slice.length, // 1 mark per question
        test_type: 'fixed',
        is_published: false,
      }, { transaction: t });

      await MockTestQuestion.bulkCreate(
        slice.map((q, i) => ({
          mock_test_id: test.id,
          question_id: q.id,
          question_order: i + 1,
        })),
        { transaction: t }
      );

      console.log(`  ${paper.title}: mock_test id ${test.id}, ${slice.length} questions`);
    }

    await t.commit();
    console.log('\n✅ Done. Both papers are UNPUBLISHED — review, set free/paid and publish in admin → Mock Tests.');
  } catch (err) {
    await t.rollback();
    throw err;
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
