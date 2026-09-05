/**
 * Load mock tests exported by scripts/export-mock-tests.js into the database the
 * current config points at. Run it against production by setting DATABASE_URL:
 *
 *   DATABASE_URL="postgres://…prod…" node scripts/import-mock-tests.js
 *   DATABASE_URL="…" node scripts/import-mock-tests.js path/to/export.json
 *   DATABASE_URL="…" node scripts/import-mock-tests.js --dry-run
 *
 * - Creates each question + its options fresh (new ids), source_type from the
 *   file, no import batch, is_active true.
 * - Creates the mock tests UNPUBLISHED — review and publish in the admin panel.
 * - Idempotent by title: a mock test whose title already exists is skipped
 *   whole, so re-running does not duplicate anything.
 */
import fs from 'fs';
import path from 'path';
import {
  sequelize, MockTest, MockTestQuestion, Question, QuestionOption, Subject,
} from '../src/models/index.js';

const toSlug = (name) => name.toLowerCase().trim().replace(/\s+/g, '-');

const run = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find((a) => !a.startsWith('--')) || 'scripts/data/mock-tests-export.json';
  const filePath = path.resolve(fileArg);

  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(payload.mock_tests)) throw new Error('File has no mock_tests array');

  console.log(`Source: ${filePath}`);
  console.log(`Target DB: ${process.env.DATABASE_URL ? 'DATABASE_URL' : `${process.env.DB_NAME}@${process.env.DB_HOST}`}`);
  console.log(dryRun ? '(dry run — nothing will be written)\n' : '');

  const subjectCache = new Map();
  const resolveSubjectId = async (name, t) => {
    if (!name) return null;
    if (subjectCache.has(name)) return subjectCache.get(name);
    const [subject] = await Subject.findOrCreate({
      where: { name },
      defaults: { slug: toSlug(name) },
      transaction: t,
    });
    subjectCache.set(name, subject.id);
    return subject.id;
  };

  for (const mt of payload.mock_tests) {
    const existing = await MockTest.findOne({ where: { title: mt.title } });
    if (existing) {
      console.log(`↷ "${mt.title}" already exists (id ${existing.id}) — skipped`);
      continue;
    }
    if (dryRun) {
      console.log(`＋ would create "${mt.title}" with ${mt.questions.length} questions`);
      continue;
    }

    const t = await sequelize.transaction();
    try {
      const orderedQuestionIds = [];

      for (const q of mt.questions) {
        const subjectId = await resolveSubjectId(q.subject_name, t);
        const question = await Question.create({
          subject_id: subjectId,
          question_number: q.question_number ?? null,
          question_text: q.question_text,
          explanation: q.explanation ?? null,
          difficulty: q.difficulty ?? 'medium',
          question_type: q.question_type ?? 'single_choice',
          source_type: q.source_type ?? 'mock',
          marks: q.marks ?? 1,
          negative_marks: q.negative_marks ?? 0,
          question_image: q.question_image ?? null,
          question_images: q.question_images ?? null,
          answer_images: q.answer_images ?? null,
          image_type: q.image_type ?? null,
          import_batch_id: null,
          is_active: true,
        }, { transaction: t });

        if (Array.isArray(q.options) && q.options.length) {
          await QuestionOption.bulkCreate(
            q.options.map((o) => ({
              question_id: question.id,
              option_key: o.option_key,
              option_text: o.option_text,
              option_image: o.option_image ?? null,
              is_correct: Boolean(o.is_correct),
              explanation: o.explanation ?? null,
            })),
            { transaction: t }
          );
        }
        orderedQuestionIds.push(question.id);
      }

      const test = await MockTest.create({
        title: mt.title,
        description: mt.description ?? null,
        duration_minutes: mt.duration_minutes ?? 60,
        total_questions: orderedQuestionIds.length,
        total_marks: mt.total_marks ?? orderedQuestionIds.length,
        test_type: 'fixed',
        randomize_questions: Boolean(mt.randomize_questions),
        randomize_options: Boolean(mt.randomize_options),
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
      console.log(`✅ "${mt.title}" → mock_test id ${test.id}, ${orderedQuestionIds.length} questions`);
    } catch (err) {
      await t.rollback();
      console.error(`✗ "${mt.title}" failed: ${err.message}`);
      throw err;
    }
  }

  console.log('\nDone. New mock tests are UNPUBLISHED — set free/paid and publish in admin → Mock Tests.');
  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
