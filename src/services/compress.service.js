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

// Image downsampling targets in dpi, tried in order.
//
// 300 is the first rung because these notes carry their real content inside
// figures — reference tables, dosing charts — not just body text, and the text
// printed inside those figures is small. 150 is the floor: below it that small
// print stops being readable, and a note nobody can read is worse than an
// upload that was refused. There is deliberately no 72 dpi rung.
//
// Measured on a 33MB source: 300 dpi lands at 5.4MB, comfortably inside the
// limit, so the lower rungs are a safety net rather than the expected path.
const DPI_LADDER = [300, 220, 150];

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

/**
 * Ghostscript arguments for one pass at a given image resolution.
 *
 * Spelled out rather than using -dPDFSETTINGS. The presets bundle a resolution
 * with a JPEG quality far below what a figure containing small print survives:
 * /ebook took a 457 dpi dosing table down to 152 dpi and re-encoded it hard
 * enough that the doses could not be read. Setting the knobs directly keeps the
 * resolution decision separate from the quality decision.
 */
const gsArgs = (src, dest, dpi) => [
  '-sDEVICE=pdfwrite',
  // 1.5 rather than 1.4 for object streams, which shrink the output at no cost
  // to image quality. Nothing that can open a PDF at all is stuck below 1.5.
  '-dCompatibilityLevel=1.5',
  '-dNOPAUSE',
  '-dQUIET',
  '-dBATCH',
  // Ghostscript is being handed a file uploaded by an admin. SAFER is its
  // default from 9.50 on, but stating it means a future base image with an
  // older gs does not silently run without the sandbox.
  '-dSAFER',

  // Normalise into sRGB. Without an explicit strategy, pdfwrite passes the
  // source's colour profiles through and re-emits one that `gs` itself then
  // reports as "errors that were repaired or ignored" — a structurally invalid
  // file we should not be handing to a client. sRGB is also the right target:
  // these notes are read on screens, and the old /ebook preset was already
  // converting to it, so nothing about the colour changes for the reader.
  '-dColorConversionStrategy=/sRGB',

  '-dDownsampleColorImages=true',
  '-dColorImageDownsampleType=/Bicubic',
  `-dColorImageResolution=${dpi}`,
  // Ghostscript's default threshold is 1.5: an image is left alone until it
  // exceeds 1.5x the target. That both keeps some images well above the target
  // and drops the rest a long way below it. 1.0 makes the target mean what it
  // says, so the whole document lands at one predictable resolution.
  '-dColorImageDownsampleThreshold=1.0',

  '-dDownsampleGrayImages=true',
  '-dGrayImageDownsampleType=/Bicubic',
  `-dGrayImageResolution=${dpi}`,
  '-dGrayImageDownsampleThreshold=1.0',

  // AutoFilter encodes every image twice to choose a codec, which cost ~22s of
  // the ~24s a 33MB file used to take — for a choice it makes badly on the
  // flat-colour diagrams these notes are mostly built from.
  '-dAutoFilterColorImages=false',
  '-dColorImageFilter=/DCTEncode',
  '-dAutoFilterGrayImages=false',
  '-dGrayImageFilter=/DCTEncode',
  '-dJPEGQ=90',

  `-sOutputFile=${dest}`,
  src,
];

const runGhostscript = async (src, dest, dpi) => {
  await execFileAsync('gs', gsArgs(src, dest, dpi), {
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
};

/**
 * Shrinks a PDF below the storage limit, in place of the caller's file.
 *
 * Returns the path to use — the original when it already fits or when
 * compression made it bigger, otherwise a temp file the caller must unlink.
 *
 * Walks the ladder and stops at the first result that fits, so a file only
 * loses image detail to the extent needed to get under the ceiling.
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
    for (const dpi of DPI_LADDER) {
      const dest = path.join(
        os.tmpdir(),
        `note-compressed-${Date.now()}-${dpi}dpi-${Math.random().toString(36).slice(2, 8)}.pdf`
      );
      temps.push(dest);

      try {
        await runGhostscript(sourcePath, dest, dpi);
      } catch (err) {
        // A ladder step failing is not fatal while another remains — only the
        // last one decides the outcome.
        console.error(`Ghostscript (${dpi} dpi) failed:`, err.message);
        continue;
      }

      const bytes = await sizeOf(dest).catch(() => 0);
      if (bytes > 0 && bytes <= STORAGE_LIMIT_BYTES) {
        // Hand back this one and clean up the rest.
        await Promise.all(
          temps.filter((f) => f !== dest).map((f) => fs.unlink(f).catch(() => {}))
        );
        return { path: dest, originalBytes, finalBytes: bytes, compressed: true, dpi };
      }
    }

    // Falling off the ladder means even the readability floor was not enough.
    // Compressing further would deliver a note whose figures cannot be read,
    // which is not a trade worth making silently.
    throw new AppError(
      `This PDF is still too large after compression at ${DPI_LADDER.at(-1)} dpi, and ` +
        'compressing further would make the images unreadable. Split it into parts ' +
        'and upload them as separate notes.',
      413
    );
  } catch (err) {
    await Promise.all(temps.map((f) => fs.unlink(f).catch(() => {})));
    throw err;
  }
};
