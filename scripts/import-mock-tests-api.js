/**
 * Load mock tests exported by scripts/export-mock-tests.js into another
 * environment over its admin HTTP API — no database access required, so this is
 * the one to use when the target DB is not reachable from where you are running.
 *
 * Set TARGET_URL and TARGET_ADMIN_TOKEN either in .env or inline:
 *
 *   # in .env:
 *   TARGET_URL=https://api.amccatalyst.com
 *   TARGET_ADMIN_TOKEN=<admin JWT>
 *   # then:
 *   npm run mocks:import:api -- --dry-run
 *   npm run mocks:import:api
 *
 *   # or inline:
 *   TARGET_URL="…" TARGET_ADMIN_TOKEN="…" node scripts/import-mock-tests-api.js [file.json] [--dry-run]
 *
 * How it works: the questions ride in on a throwaway import batch (the existing
 * /import-batches/:id/receive endpoint), which is then hidden and left as a
 * record. A mock test is created and the freshly-made questions are attached in
 * order. Idempotent by title — an existing mock test is skipped whole.
 *
 * Question figures bundled by the export (scripts/data/mock-images/) are
 * re-uploaded to the target's own S3 via its image endpoint — so this works
 * whether or not the two environments share a bucket, and never spends Claude
 * credits.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const BASE = (process.env.TARGET_URL || '').replace(/\/$/, '');
const TOKEN = (process.env.TARGET_ADMIN_TOKEN || '').replace(/^"|"$/g, '');

if (!BASE || !TOKEN) {
  console.error(
    'Set TARGET_URL and TARGET_ADMIN_TOKEN — either as two lines in .env, or inline before the command.'
  );
  process.exit(1);
}

const api = async (method, url, body) => {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
};

// question_image path → local bundled file → uploaded to the target, cached.
const makeImageRehoster = (imageDir) => {
  const cache = new Map();
  return async (ref) => {
    const m = typeof ref === 'string' && ref.match(/[?&]key=([^&]+)/);
    if (!m) return null;
    const key = decodeURIComponent(m[1]);
    if (!key.startsWith('question-images/')) return null;

    const file = key.split('/').pop();
    if (cache.has(file)) return cache.get(file);

    const local = path.join(imageDir, file);
    if (!fs.existsSync(local)) {
      console.warn(`⚠  bundled image missing, question will import without it: ${file}`);
      cache.set(file, null);
      return null;
    }

    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[
      file.split('.').pop().toLowerCase()
    ] || 'image/png';
    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(local)], { type: mime }), file);
    const res = await fetch(`${BASE}/api/admin/import-batches/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` }, // let fetch set the multipart boundary
      body: form,
    });
    if (!res.ok) throw new Error(`image upload → ${res.status} ${await res.text()}`);
    const newPath = (await res.json()).path;
    cache.set(file, newPath);
    return newPath;
  };
};

const run = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find((a) => !a.startsWith('--')) || 'scripts/data/mock-tests-export.json';
  const jsonPath = path.resolve(fileArg);
  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(payload.mock_tests)) throw new Error('File has no mock_tests array');

  const rehostImage = makeImageRehoster(path.join(path.dirname(jsonPath), 'mock-images'));

  console.log(`Target: ${BASE}`);
  console.log(dryRun ? '(dry run)\n' : '');

  const existing = await api('GET', '/admin/mock-tests');
  const existingTitles = new Set((existing.data ?? existing).map((t) => t.title));

  for (const mt of payload.mock_tests) {
    if (existingTitles.has(mt.title)) {
      console.log(`↷ "${mt.title}" already on target — skipped`);
      continue;
    }
    const imgRefs = mt.questions.filter(
      (q) => q.question_image || (q.question_images || []).length
    ).length;
    if (dryRun) {
      console.log(`＋ would create "${mt.title}" (${mt.questions.length} questions, ${imgRefs} with images)`);
      continue;
    }

    // 0. Re-host each question's figure onto the target's storage.
    const rehostedPaths = new Set();
    for (const q of mt.questions) {
      const refs = [...new Set([q.question_image, ...(q.question_images || [])].filter(Boolean))];
      q._images = [];
      for (const ref of refs) {
        const p = await rehostImage(ref);
        if (p && !q._images.includes(p)) {
          q._images.push(p);
          rehostedPaths.add(p);
        }
      }
    }
    if (imgRefs) console.log(`   ${rehostedPaths.size} image(s) uploaded to target`);

    // 1. Questions in via a throwaway batch.
    const { batch_id } = await api('POST', '/admin/import-batches', {
      title: `${mt.title} — source`,
    });
    await api('POST', `/admin/import-batches/${batch_id}/receive`, {
      status: 'success',
      total_questions: mt.questions.length,
      questions: mt.questions.map((q) => ({
        question_number: q.question_number,
        question_text: q.question_text,
        explanation: q.explanation,
        difficulty: q.difficulty,
        question_type: q.question_type,
        source_type: q.source_type || 'mock',
        marks: q.marks,
        negative_marks: q.negative_marks,
        subject: q.subject_name,
        ...(q._images.length ? { images: q._images } : {}),
        options: q.options.map((o) => ({
          option_key: o.option_key,
          option_text: o.option_text,
          option_image: o.option_image,
          is_correct: o.is_correct,
          explanation: o.explanation,
        })),
      })),
    });

    // 2. Read the created questions back and line them up with the file by text.
    const batch = await api('GET', `/admin/import-batches/${batch_id}`);
    const byText = new Map((batch.questions ?? []).map((q) => [q.question_text, q.id]));
    const orderedIds = mt.questions.map((q) => byText.get(q.question_text)).filter(Boolean);
    if (orderedIds.length !== mt.questions.length) {
      throw new Error(
        `"${mt.title}": matched ${orderedIds.length}/${mt.questions.length} questions back — aborting before creating the test`
      );
    }

    // 3. The mock test, UNPUBLISHED.
    const test = await api('POST', '/admin/mock-tests', {
      title: mt.title,
      description: mt.description ?? undefined,
      duration_minutes: mt.duration_minutes ?? 60,
      total_marks: mt.total_marks ?? orderedIds.length,
      test_type: 'fixed',
      randomize_questions: Boolean(mt.randomize_questions),
      randomize_options: Boolean(mt.randomize_options),
    });
    const testId = test.id ?? test.data?.id;

    await api('POST', `/admin/mock-tests/${testId}/questions`, {
      questions: orderedIds.map((qid, i) => ({ question_id: qid, question_order: i + 1 })),
    });

    // 4. Hide the source batch so its questions don't surface as loose qbank rows.
    await api('PATCH', `/admin/import-batches/${batch_id}/visibility`, { is_visible: false });

    console.log(`✅ "${mt.title}" → mock test ${testId}, ${orderedIds.length} questions (source batch ${batch_id}, hidden)`);
  }

  console.log('\nDone. New mock tests are UNPUBLISHED — set free/paid and publish in admin → Mock Tests.');
};

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
