/**
 * Upload study-note PDFs to S3 and register them for the Notes page.
 *
 *   npm run notes:upload -- ./notes/*.pdf
 *
 * A bulk alternative to the admin UI (Admin → Notes), useful for seeding a
 * batch of files at once. Both go through publishNote() in note.service.js, so
 * validation, naming and the private-object settings are identical either way.
 *
 * Titles come from filenames: "cardiology-basics.pdf" -> "Cardiology Basics".
 * Re-running on the same filename updates that note rather than creating a
 * duplicate; use the admin UI to set descriptions.
 *
 * Files are uploaded exactly as given, at full quality — S3 has no size
 * ceiling that matters here.
 */
import path from 'path';
import { isStorageConfigured } from '../src/config/storage.js';
import { sequelize, Note } from '../src/models/index.js';
import { publishNote } from '../src/services/note.service.js';

const run = async () => {
  const files = process.argv.slice(2);

  if (!files.length) {
    console.error('usage: npm run notes:upload -- <file.pdf> [more.pdf ...]');
    process.exit(1);
  }

  if (!isStorageConfigured) {
    console.error(
      'S3 storage is not configured. Set AWS_REGION and S3_BUCKET (and, outside EC2,\n' +
        'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) in .env before running this.'
    );
    process.exit(1);
  }

  await sequelize.authenticate();

  // Creates `notes` if it is missing and does nothing when it already exists.
  // Deliberately sync() and not sync({ alter: true }): alter rewrites live
  // columns, and this script runs against production.
  await Note.sync();

  let created = 0;
  let updated = 0;
  const failures = [];

  for (const [index, file] of files.entries()) {
    const base = path.basename(file);

    try {
      const { note, created: isNew } = await publishNote({
        filePath: file,
        filename: base,
        sort_order: index,
      });

      isNew ? created++ : updated++;
      console.log(`${isNew ? 'created' : 'updated'}  ${note.title}  (id ${note.id})`);
    } catch (err) {
      failures.push(base);
      console.error(`failed   ${base}: ${err.message}`);
    }
  }

  console.log(`\n${created} created, ${updated} updated, ${failures.length} failed.`);

  await sequelize.close();
  // Non-zero on any failure so this is safe to use from a script or CI step.
  process.exit(failures.length ? 1 : 0);
};

run().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
