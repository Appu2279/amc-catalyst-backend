/**
 * Builds the smaller copies students on slow networks are served: a compressed
 * PDF beside every note and a resized JPEG beside every cover.
 *
 *   npm run notes:optimize             # only items that have no copy yet
 *   npm run notes:optimize -- --force  # rebuild every copy
 *
 * Originals are only read, never changed. Whether students actually get these
 * copies is decided by SERVE_OPTIMIZED_NOTES, not by this script.
 */
import { isStorageConfigured, getObjectBuffer, objectExists } from '../src/config/storage.js';
import { sequelize, Note } from '../src/models/index.js';
import {
  optimizeNoteFile,
  optimizedKeyFor,
  createCoverThumb,
  coverThumbKeyFor,
} from '../src/services/noteOptimize.service.js';

const toMb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

const optimizePdf = async (note, isForced) => {
  if (!isForced && (await objectExists(optimizedKeyFor(note.storage_public_id)))) {
    console.log(`skip     ${note.title} (already optimized)`);
    return;
  }

  const { originalBytes, optimizedBytes } = await optimizeNoteFile(note.storage_public_id);
  console.log(
    optimizedBytes
      ? `pdf      ${note.title}: ${toMb(originalBytes)} -> ${toMb(optimizedBytes)}`
      : `pdf      ${note.title}: ${toMb(originalBytes)}, no gain, original kept`
  );
};

const createThumb = async (note, isForced) => {
  if (!note.cover_image_key) return;
  if (!isForced && (await objectExists(coverThumbKeyFor(note.cover_image_key)))) return;

  const { buffer } = await getObjectBuffer(note.cover_image_key);
  await createCoverThumb(note.cover_image_key, buffer);
  console.log(`cover    ${note.title}: ${toMb(buffer.length)} original`);
};

const run = async () => {
  if (!isStorageConfigured) {
    console.error('S3 storage is not configured. Set AWS_REGION and S3_BUCKET in .env.');
    process.exit(1);
  }

  const isForced = process.argv.includes('--force');
  await sequelize.authenticate();

  const notes = await Note.findAll({
    attributes: ['id', 'title', 'storage_public_id', 'cover_image_key'],
    order: [['id', 'ASC']],
  });

  const failures = [];
  // Sequential on purpose: one PDF peaks around 500 MB of memory, on a 2 GB
  // instance that is also serving students.
  for (const note of notes) {
    try {
      await optimizePdf(note, isForced);
      await createThumb(note, isForced);
    } catch (err) {
      failures.push(note.title);
      console.error(`failed   ${note.title}: ${err.message}`);
    }
  }

  console.log(`\n${notes.length} notes checked, ${failures.length} failed.`);
  await sequelize.close();
  process.exit(failures.length ? 1 : 0);
};

run().catch(async (err) => {
  console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
