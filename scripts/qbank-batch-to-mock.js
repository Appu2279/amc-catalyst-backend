/**
 * Turn a completed qbank import batch into a single fixed mock test, without
 * re-extracting anything.
 *
 *   node scripts/qbank-batch-to-mock.js <batchId> "<Mock title>" [minutesPerQuestion]
 *   node scripts/qbank-batch-to-mock.js 16 "eMedici Mock 2025" 1.4
 *
 * - questions: source_type qbank -> mock, import_batch_id -> null
 * - deletes the now-empty batch
 * - creates the mock UNPUBLISHED, questions in question_number order, marks =
 *   question count, duration = round(count * minutesPerQuestion)
 */
import { sequelize, Question, ImportBatch, MockTest, MockTestQuestion, UserMockAttempt } from '../src/models/index.js';

const run = async () => {
  const [batchIdArg, title, perQArg] = process.argv.slice(2);
  const batchId = Number(batchIdArg);
  const perQ = Number(perQArg) || 1.4;

  if (!batchId || !title) {
    console.error('Usage: node scripts/qbank-batch-to-mock.js <batchId> "<title>" [minutesPerQuestion]');
    process.exit(1);
  }

  const batch = await ImportBatch.findByPk(batchId);
  if (!batch) throw new Error(`Import batch ${batchId} not found`);
  if (await MockTest.findOne({ where: { title } })) {
    throw new Error(`A mock test titled "${title}" already exists`);
  }

  const questions = await Question.findAll({
    where: { import_batch_id: batchId },
    order: [['question_number', 'ASC'], ['id', 'ASC']],
    attributes: ['id', 'question_number'],
  });
  if (!questions.length) throw new Error(`Batch ${batchId} has no questions`);
  console.log(`Batch ${batchId} "${batch.title}": ${questions.length} questions`);

  const t = await sequelize.transaction();
  try {
    await Question.update(
      { source_type: 'mock', import_batch_id: null },
      { where: { id: questions.map((q) => q.id) }, transaction: t }
    );
    await batch.destroy({ transaction: t });

    const duration = Math.round(questions.length * perQ);
    const test = await MockTest.create({
      title,
      description: `Imported from "${batch.title}".`,
      duration_minutes: duration,
      total_questions: questions.length,
      total_marks: questions.length,
      test_type: 'fixed',
      is_published: false,
    }, { transaction: t });

    await MockTestQuestion.bulkCreate(
      questions.map((q, i) => ({ mock_test_id: test.id, question_id: q.id, question_order: i + 1 })),
      { transaction: t }
    );

    await t.commit();
    console.log(`\n✅ "${title}" → mock_test id ${test.id}, ${questions.length} questions, ${duration} min, UNPUBLISHED.`);
    console.log('   Next: node scripts/export-mock-tests.js');
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // Not touched inside the transaction — just a heads-up.
  const attempts = await UserMockAttempt.count();
  if (attempts) console.log(`   (${attempts} mock attempt row(s) exist across all tests — unaffected.)`);

  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
