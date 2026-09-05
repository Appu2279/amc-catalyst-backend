/**
 * One-off: fold the 9 backfilled questions (from import batches 10 & 12) into the
 * "AMC Free 209 MCQ" mock, then bin the temp batches and their duplicate rows.
 *
 *   node scripts/add-9-to-209-mock.js
 *
 * Targets: Q21, Q172 (batch 12) and Q203–209 (batch 10). Batches 10/11/12 also
 * hold throwaway duplicate rows for questions already in the mock — those are
 * deleted with the batches. The mock's question order is rebuilt from scratch by
 * question_number so the 9 land in the right places.
 */
import { sequelize, Question, QuestionOption, ImportBatch, MockTest, MockTestQuestion } from '../src/models/index.js';
import { Op } from 'sequelize';

const MOCK_TITLE = 'AMC Free 209 MCQ';
const TEMP_BATCHES = [10, 11, 12];
const WANT = [
  { batch: 12, numbers: [21, 172] },
  { batch: 10, numbers: [203, 204, 205, 206, 207, 208, 209] },
];

const run = async () => {
  const mock = await MockTest.findOne({ where: { title: MOCK_TITLE } });
  if (!mock) throw new Error(`Mock "${MOCK_TITLE}" not found`);

  // Resolve the 9 target question ids.
  const targets = [];
  for (const { batch, numbers } of WANT) {
    for (const n of numbers) {
      const q = await Question.findOne({ where: { import_batch_id: batch, question_number: n } });
      if (!q) throw new Error(`Batch ${batch} has no question_number ${n}`);
      targets.push(q);
    }
  }
  console.log(`Targets: ${targets.map((q) => `Q${q.question_number}`).join(', ')} (${targets.length})`);

  const t = await sequelize.transaction();
  try {
    // 1. Move the 9 into the mock pool.
    await Question.update(
      { source_type: 'mock', import_batch_id: null },
      { where: { id: targets.map((q) => q.id) }, transaction: t }
    );

    // 2. Delete the temp batches and every remaining (duplicate) row in them.
    const leftover = await Question.findAll({
      where: { import_batch_id: { [Op.in]: TEMP_BATCHES } },
      attributes: ['id'],
      transaction: t,
    });
    const leftoverIds = leftover.map((q) => q.id);
    if (leftoverIds.length) {
      await QuestionOption.destroy({ where: { question_id: leftoverIds }, transaction: t });
      await Question.destroy({ where: { id: leftoverIds }, transaction: t });
    }
    await ImportBatch.destroy({ where: { id: { [Op.in]: TEMP_BATCHES } }, transaction: t });
    console.log(`Removed ${leftoverIds.length} duplicate rows + ${TEMP_BATCHES.length} temp batches`);

    // 3. Rebuild the mock's question list, ordered by question_number.
    const currentLinks = await MockTestQuestion.findAll({
      where: { mock_test_id: mock.id },
      include: [{ model: Question, as: 'question', attributes: ['id', 'question_number'] }],
      transaction: t,
    });
    const all = [
      ...currentLinks.map((l) => l.question),
      ...targets,
    ].sort((a, b) => (a.question_number ?? 0) - (b.question_number ?? 0));

    await MockTestQuestion.destroy({ where: { mock_test_id: mock.id }, transaction: t });
    await MockTestQuestion.bulkCreate(
      all.map((q, i) => ({ mock_test_id: mock.id, question_id: q.id, question_order: i + 1 })),
      { transaction: t }
    );

    const duration = Math.round(all.length * 1.4);
    await mock.update(
      { total_questions: all.length, total_marks: all.length, duration_minutes: duration },
      { transaction: t }
    );

    await t.commit();
    console.log(`\n✅ "${MOCK_TITLE}": ${all.length} questions, ${duration} min, ${all.length} marks (unpublished).`);
    console.log('   Next: node scripts/export-mock-tests.js');
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
