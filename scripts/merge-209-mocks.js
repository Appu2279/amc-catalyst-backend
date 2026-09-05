/**
 * One-off: merge "AMC Free 209 MCQ — Paper 1" + "Paper 2" back into a single
 * 200-question mock test. The questions are untouched — only the mock_tests /
 * mock_test_questions rows change.
 *
 *   node scripts/merge-209-mocks.js
 *
 * Result: one "AMC Free 209 MCQ" mock, 200 questions in the same order, 280 min
 * (200 × 1.4), 200 marks, UNPUBLISHED. Re-run scripts/export-mock-tests.js after
 * this to refresh the export file for production.
 */
import { sequelize, MockTest, MockTestQuestion, UserMockAttempt } from '../src/models/index.js';

const SOURCE_TITLES = ['AMC Free 209 MCQ — Paper 1', 'AMC Free 209 MCQ — Paper 2'];
const NEW_TITLE = 'AMC Free 209 MCQ';
const DURATION_MIN = Math.round(200 * 1.4); // 280

const run = async () => {
  const sources = await MockTest.findAll({ where: { title: SOURCE_TITLES }, order: [['id', 'ASC']] });
  if (sources.length !== 2) {
    throw new Error(`Expected the 2 paper mock tests, found ${sources.length}: ${sources.map((s) => s.title).join(', ')}`);
  }

  // Collect question ids in paper order, then paper 1 followed by paper 2.
  const orderedById = new Map(sources.map((s) => [s.id, []]));
  for (const source of sources) {
    const links = await MockTestQuestion.findAll({
      where: { mock_test_id: source.id },
      order: [['question_order', 'ASC'], ['id', 'ASC']],
      attributes: ['question_id'],
    });
    orderedById.set(source.id, links.map((l) => l.question_id));
  }
  const orderedQuestionIds = SOURCE_TITLES
    .map((title) => sources.find((s) => s.title === title))
    .flatMap((s) => orderedById.get(s.id));

  console.log(`Paper 1: ${orderedById.get(sources[0].id).length} q, Paper 2: ${orderedById.get(sources[1].id).length} q → merged ${orderedQuestionIds.length}`);

  const attemptCount = await UserMockAttempt.count({ where: { mock_test_id: sources.map((s) => s.id) } });
  if (attemptCount) throw new Error(`${attemptCount} attempt(s) reference these tests — refusing to delete them`);

  const existing = await MockTest.findOne({ where: { title: NEW_TITLE } });
  if (existing) throw new Error(`"${NEW_TITLE}" already exists (id ${existing.id})`);

  const t = await sequelize.transaction();
  try {
    // FK is ON DELETE CASCADE, so this also clears the paper links.
    await MockTest.destroy({ where: { id: sources.map((s) => s.id) }, transaction: t });

    const test = await MockTest.create({
      title: NEW_TITLE,
      description: 'Imported from the AMC Free 209 MCQ set.',
      duration_minutes: DURATION_MIN,
      total_questions: orderedQuestionIds.length,
      total_marks: orderedQuestionIds.length,
      test_type: 'fixed',
      is_published: false,
    }, { transaction: t });

    await MockTestQuestion.bulkCreate(
      orderedQuestionIds.map((qid, i) => ({
        mock_test_id: test.id,
        question_id: qid,
        question_order: i + 1,
      })),
      { transaction: t }
    );

    await t.commit();
    console.log(`\n✅ "${NEW_TITLE}" → mock_test id ${test.id}, ${orderedQuestionIds.length} questions, ${DURATION_MIN} min, UNPUBLISHED.`);
    console.log('   Next: node scripts/export-mock-tests.js   (refresh the export file)');
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
