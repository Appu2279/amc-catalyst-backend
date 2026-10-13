import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import {
  getObjectBuffer,
  uploadNoteBuffer,
  uploadNoteCover,
  destroyObject,
  isMissingObjectError,
} from '../config/storage.js';

/**
 * Smaller copies of note PDFs and cover images, for students on slow networks.
 *
 * The originals are never touched. Each optimised copy sits beside its original
 * under a derived key, and SERVE_OPTIMIZED_NOTES decides which one students
 * get. Turning the flag off puts every student back on the untouched originals
 * with a container restart — no rebuild, no data change — which is the
 * rollback the client asked for in case they reject the compressed versions.
 */

const execFileAsync = promisify(execFile);

const OPTIMIZE_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/optimize-pdf.py'
);
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

// A 70 MB, 38-page note took ~8s on a laptop. A t4g.small is slower, and this
// leaves room for the largest notes without letting a wedged process live forever.
const OPTIMIZE_TIMEOUT_MS = 5 * 60 * 1000;

// Covers are shown as shelf cards and in the homepage slideshow. 800px wide is
// sharp on a 2x screen at either size.
const COVER_THUMB_WIDTH = 800;

export const isServingOptimized = () => process.env.SERVE_OPTIMIZED_NOTES === 'true';

// slugify() turns dots into dashes, so no uploaded note can ever produce a key
// that collides with one of these.
export const optimizedKeyFor = (noteKey) => `${noteKey.replace(/\.pdf$/i, '')}.optimized.pdf`;
export const coverThumbKeyFor = (coverKey) => `${coverKey}.thumb.jpg`;

/**
 * Fetches the optimised copy when the flag is on and one exists, else the
 * original. A note uploaded moments ago has no optimised copy yet, so falling
 * back is the normal path for it, not an error.
 */
const getPreferredObject = async (originalKey, optimizedKey) => {
  if (isServingOptimized()) {
    try {
      return await getObjectBuffer(optimizedKey);
    } catch (err) {
      if (!isMissingObjectError(err)) {
        console.error(`Fetching ${optimizedKey} failed, serving the original:`, err.message);
      }
    }
  }
  return getObjectBuffer(originalKey);
};

export const getNoteFileObject = (noteKey) =>
  getPreferredObject(noteKey, optimizedKeyFor(noteKey));

export const getNoteCoverObject = (coverKey) =>
  getPreferredObject(coverKey, coverThumbKeyFor(coverKey));

/**
 * Builds and stores the optimised copy of one note PDF.
 *
 * When compression gains nothing, any previous optimised copy is removed so a
 * stale one can never shadow a newer original.
 */
export const optimizeNoteFile = async (noteKey) => {
  const { buffer: original } = await getObjectBuffer(noteKey);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'note-optimize-'));

  try {
    const sourcePath = path.join(workDir, 'source.pdf');
    const destPath = path.join(workDir, 'optimized.pdf');
    await fs.writeFile(sourcePath, original);
    await execFileAsync(PYTHON_BIN, [OPTIMIZE_SCRIPT, sourcePath, destPath], {
      timeout: OPTIMIZE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const optimized = await fs.readFile(destPath);

    if (optimized.length >= original.length) {
      await destroyObject(optimizedKeyFor(noteKey));
      return { originalBytes: original.length, optimizedBytes: null };
    }

    await uploadNoteBuffer(optimized, optimizedKeyFor(noteKey));
    return { originalBytes: original.length, optimizedBytes: optimized.length };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
};

// One at a time: a single optimisation peaks around 500 MB of memory, and the
// API, Postgres and Caddy share a 2 GB instance.
let optimizationQueue = Promise.resolve();

/**
 * Optimises a note in the background after an admin upload, so the upload
 * request is not held open for it. Until it finishes students get the original.
 */
export const queueNoteOptimization = (noteKey) => {
  optimizationQueue = optimizationQueue
    .then(() => optimizeNoteFile(noteKey))
    .then(({ originalBytes, optimizedBytes }) => {
      const result = optimizedBytes
        ? `${originalBytes} -> ${optimizedBytes} bytes`
        : 'no gain, original kept';
      console.log(`Optimized note ${noteKey}: ${result}`);
    })
    .catch((err) => {
      console.error(`Optimizing note ${noteKey} failed; students get the original:`, err.message);
    });
};

// Called when an original is replaced or deleted, so its old optimised copy
// can never be served in its place.
export const removeOptimizedNoteFile = (noteKey) => destroyObject(optimizedKeyFor(noteKey));

/**
 * Stores a resized JPEG beside an uploaded cover. Cover uploads can be up to
 * 5 MB, yet they are only ever shown as cards.
 */
export const createCoverThumb = async (coverKey, buffer) => {
  const thumb = await sharp(buffer, { animated: false })
    .rotate()
    .resize({ width: COVER_THUMB_WIDTH, withoutEnlargement: true })
    // PNG covers can be transparent; JPEG has no alpha and would turn it black.
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  if (thumb.length >= buffer.length) return;
  await uploadNoteCover(thumb, coverThumbKeyFor(coverKey), 'image/jpeg');
};

export const removeCoverThumb = (coverKey) => destroyObject(coverThumbKeyFor(coverKey));
