/**
 * Export mock tests (with every question, option and explanation) to a JSON
 * file, so a set extracted once on one environment can be loaded into another
 * without re-running the importer / spending Claude credits.
 *
 *   node scripts/export-mock-tests.js               # all fixed mock tests
 *   node scripts/export-mock-tests.js 3 4           # only these ids
 *   node scripts/export-mock-tests.js 3 4 out.json  # custom output path
 *
 * Pairs with scripts/import-mock-tests.js.
 */
import fs from 'fs';
import path from 'path';
import {
  sequelize, MockTest, MockTestQuestion, Question, QuestionOption, Subject,
} from '../src/models/index.js';
import { getObjectBuffer, isStorageConfigured } from '../src/config/storage.js';

// A question figure the import service stored is referenced as
// "/api/images/question?key=question-images/<uuid>.<ext>". Pull the S3 key back
// out so the bytes can be bundled with the export.
const keyFromPath = (p) => {
  if (typeof p !== 'string') return null;
  const m = p.match(/[?&]key=([^&]+)/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]);
  return key.startsWith('question-images/') ? key : null;
};

const run = async () => {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.endsWith('.json'));
  const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const outPath = path.resolve(outArg || 'scripts/data/mock-tests-export.json');
  const imageDir = path.join(path.dirname(outPath), 'mock-images');

  const tests = await MockTest.findAll({
    where: { test_type: 'fixed', ...(ids.length ? { id: ids } : {}) },
    order: [['id', 'ASC']],
  });
  if (!tests.length) throw new Error('No fixed mock tests matched');

  const payload = { exported_at: new Date().toISOString(), mock_tests: [] };

  for (const test of tests) {
    const links = await MockTestQuestion.findAll({
      where: { mock_test_id: test.id },
      order: [['question_order', 'ASC'], ['id', 'ASC']],
      include: [{
        model: Question,
        as: 'question',
        include: [
          { model: QuestionOption, as: 'options' },
          { model: Subject, as: 'subject', attributes: ['name'] },
        ],
      }],
    });

    payload.mock_tests.push({
      title: test.title,
      description: test.description,
      duration_minutes: test.duration_minutes,
      total_marks: test.total_marks,
      randomize_questions: test.randomize_questions,
      randomize_options: test.randomize_options,
      questions: links.map((link, i) => {
        const q = link.question;
        return {
          order: link.question_order ?? i + 1,
          question_number: q.question_number,
          question_text: q.question_text,
          explanation: q.explanation,
          difficulty: q.difficulty,
          question_type: q.question_type,
          source_type: q.source_type,
          marks: q.marks,
          negative_marks: q.negative_marks,
          question_image: q.question_image,
          question_images: q.question_images,
          answer_images: q.answer_images,
          image_type: q.image_type,
          subject_name: q.subject?.name ?? null,
          options: [...q.options]
            .sort((a, b) => String(a.option_key).localeCompare(String(b.option_key)))
            .map((o) => ({
              option_key: o.option_key,
              option_text: o.option_text,
              option_image: o.option_image,
              is_correct: o.is_correct,
              explanation: o.explanation,
            })),
        };
      }),
    });
  }

  // Bundle every referenced question figure next to the JSON so the import can
  // re-host it without touching this environment's S3.
  const keys = new Set();
  for (const t of payload.mock_tests) {
    for (const q of t.questions) {
      for (const p of [q.question_image, ...(q.question_images || [])]) {
        const k = keyFromPath(p);
        if (k) keys.add(k);
      }
    }
  }

  let savedImages = 0;
  if (keys.size) {
    if (!isStorageConfigured) {
      console.warn(`⚠  ${keys.size} question image(s) referenced but S3 is not configured — images NOT bundled`);
    } else {
      fs.mkdirSync(imageDir, { recursive: true });
      for (const key of keys) {
        const file = key.split('/').pop();
        try {
          const { buffer } = await getObjectBuffer(key);
          fs.writeFileSync(path.join(imageDir, file), buffer);
          savedImages += 1;
        } catch (err) {
          console.warn(`⚠  could not fetch ${key}: ${err.message}`);
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const totalQ = payload.mock_tests.reduce((n, t) => n + t.questions.length, 0);
  console.log(`✅ Exported ${payload.mock_tests.length} mock test(s), ${totalQ} questions`);
  for (const t of payload.mock_tests) console.log(`   • ${t.title} — ${t.questions.length} questions`);
  console.log(`   → ${outPath}`);
  if (keys.size) console.log(`   → ${savedImages}/${keys.size} images → ${imageDir}`);

  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
