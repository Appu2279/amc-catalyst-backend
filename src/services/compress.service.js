import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AppError } from '../utils/AppError.js';

const execFileAsync = promisify(execFile);

// Cloudinary's raw-file ceiling on the current plan. Anything at or under this
// is uploaded untouched — recompressing a small PDF costs seconds of CPU and
// can make it larger.
export const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024;

// Ghostscript image-downsampling presets, tried in order. /ebook (150 dpi) is
// visually indistinguishable at reading size for scanned notes and typically
// saves ~85%; /screen (72 dpi) is the fallback for files that are still too big.
const QUALITY_LADDER = ['ebook', 'screen'];

// Ghostscript is CPU-bound and single-threaded. A 33MB scan measured ~24s on a
// developer laptop and will be slower on a small instance, so this is generous
// — but finite, so a pathological file cannot pin a core indefinitely.
const TIMEOUT_MS = 10 * 60 * 1000;

let ghostscriptChecked;

/**
 * Whether `gs` is on PATH. Checked once and cached.
 *
 * Deliberately not fatal at boot: a server without Ghostscript still serves
 * notes and accepts files under the storage limit perfectly well. Only an
 * oversized upload needs it, and that path reports the problem clearly.
 */
export const hasGhostscript = async () => {
  ghostscriptChecked ??= execFileAsync('gs', ['--version'])
    .then(() => true)
    .catch(() => false);
  return ghostscriptChecked;
};

const sizeOf = async (file) => (await fs.stat(file)).size;

const runGhostscript = async (src, dest, quality) => {
  await execFileAsync(
    'gs',
    [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=/${quality}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      // Ghostscript is being handed a file uploaded by an admin. SAFER is its
      // default from 9.50 on, but stating it means a future base image with an
      // older gs does not silently run without the sandbox.
      '-dSAFER',
      `-sOutputFile=${dest}`,
      src,
    ],
    { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }
  );
};

/**
 * Shrinks a PDF below the storage limit, in place of the caller's file.
 *
 * Returns the path to use — the original when it already fits or when
 * compression made it bigger, otherwise a temp file the caller must unlink.
 *
 * Walks the quality ladder and stops at the first result that fits, so a file
 * only loses image detail to the extent needed to get under the ceiling.
 */
export const compressToFit = async (sourcePath) => {
  const originalBytes = await sizeOf(sourcePath);

  if (originalBytes <= STORAGE_LIMIT_BYTES) {
    return { path: sourcePath, originalBytes, finalBytes: originalBytes, compressed: false };
  }

  if (!(await hasGhostscript())) {
    throw new AppError(
      'This PDF is too large for storage and cannot be compressed on this server ' +
        '(Ghostscript is not installed). Compress it locally and upload again.',
      413
    );
  }

  const temps = [];
  try {
    for (const quality of QUALITY_LADDER) {
      const dest = path.join(
        os.tmpdir(),
        `note-compressed-${Date.now()}-${quality}-${Math.random().toString(36).slice(2, 8)}.pdf`
      );
      temps.push(dest);

      try {
        await runGhostscript(sourcePath, dest, quality);
      } catch (err) {
        // A ladder step failing is not fatal while another remains — only the
        // last one decides the outcome.
        console.error(`Ghostscript (${quality}) failed:`, err.message);
        continue;
      }

      const bytes = await sizeOf(dest).catch(() => 0);
      if (bytes > 0 && bytes <= STORAGE_LIMIT_BYTES) {
        // Hand back this one and clean up the rest.
        await Promise.all(
          temps.filter((f) => f !== dest).map((f) => fs.unlink(f).catch(() => {}))
        );
        return { path: dest, originalBytes, finalBytes: bytes, compressed: true, quality };
      }
    }

    throw new AppError(
      'This PDF is still too large after compression. Split it into parts and ' +
        'upload them as separate notes.',
      413
    );
  } catch (err) {
    await Promise.all(temps.map((f) => fs.unlink(f).catch(() => {})));
    throw err;
  }
};
