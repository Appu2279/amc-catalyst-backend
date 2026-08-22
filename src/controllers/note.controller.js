import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs/promises';
import * as NoteService from '../services/note.service.js';
import { watermarkPdf } from '../services/watermark.service.js';
import { User } from '../models/index.js';
import { signedNoteUrl, isCloudinaryConfigured } from '../config/cloudinary.js';
import { AppError } from '../utils/AppError.js';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const listNotes = handle(() => NoteService.listNotes());

// ── Admin ─────────────────────────────────────────────────────────────────────

export const listNotesAdmin = handle(() => NoteService.listNotesAdmin());

export const createNote = handle(async (req, res) => {
  if (!req.file) throw new AppError('Choose a PDF to upload', 400);

  // Multipart fields arrive as strings; an empty or non-numeric sort_order must
  // fall through to the model default rather than writing NaN.
  const parsedOrder = Number(req.body.sort_order);
  const sort_order = Number.isFinite(parsedOrder) ? parsedOrder : undefined;

  try {
    const { note, created, compression } = await NoteService.publishNote({
      filePath: req.file.path,
      filename: req.file.originalname,
      title: req.body.title,
      description: req.body.description,
      sort_order,
      created_by: req.user.id,
    });

    // 200 rather than 201 when an existing note was replaced, so the UI can tell
    // the admin their re-upload updated a note instead of adding a second one.
    res.status(created ? 201 : 200);

    // Surfaced so the admin learns their 33MB file became 3MB, rather than
    // silently wondering why the stored size does not match what they picked.
    return {
      ...NoteService.toAdminView(note),
      compression: compression.compressed
        ? {
            compressed: true,
            original_bytes: compression.originalBytes,
            final_bytes: compression.finalBytes,
            quality: compression.quality,
          }
        : { compressed: false },
    };
  } finally {
    // multer wrote this to the OS temp directory and will not remove it.
    await fs.unlink(req.file.path).catch(() => {});
  }
});

export const updateNote = handle(async (req) =>
  NoteService.toAdminView(await NoteService.updateNote(req.params.id, req.body))
);

export const deleteNote = handle((req) => NoteService.deleteNote(req.params.id));

/**
 * Fetch a URL, following at most `hops` redirects.
 *
 * Cloudinary answers signed raw delivery with a 302 to its CDN often enough
 * that not following one would make this endpoint fail intermittently rather
 * than never — the worst kind of bug to diagnose in production.
 */
const fetchFollowing = (url, hops, onResponse, onError) => {
  const parsed = new URL(url);
  const lib = parsed.protocol === 'https:' ? https : http;

  const req = lib.get(parsed.toString(), (res) => {
    const { statusCode, headers } = res;

    if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && hops > 0) {
      res.resume(); // drain, or the socket is held open
      return fetchFollowing(
        new URL(headers.location, parsed).toString(),
        hops - 1,
        onResponse,
        onError
      );
    }

    onResponse(res);
  });

  req.on('error', onError);
  req.setTimeout(15_000, () => {
    req.destroy();
    onError(new Error('timeout'));
  });
};

/**
 * GET /api/notes/:id/file
 *
 * Returns the PDF through the backend so the Cloudinary URL never reaches the
 * browser — the same reasoning as the image proxy in image.routes.js, and the
 * reason notes are uploaded as private `authenticated` assets.
 *
 * Every copy is watermarked with the requesting account's email before it is
 * sent. That means the response is built in memory rather than piped straight
 * through: the whole document has to be present to stamp it. At a few MB per
 * note that is a fine trade for having every leaked copy identify its source.
 *
 * View-only posture:
 *   • Content-Disposition: inline  → opens in the viewer, no "Save as" prompt
 *   • Cache-Control: no-store      → not written to the browser's disk cache
 *   • Signed upstream URL expires in minutes and is used server-side only
 */
export const streamNoteFile = async (req, res) => {
  let note;
  let viewer;

  // Everything that can fail with a status code happens before the first byte
  // is written — once the response starts, res.status() is a silent no-op.
  try {
    note = await NoteService.getNoteForViewing(req.params.id, req.user);
    if (!isCloudinaryConfigured) {
      throw new AppError('File storage is not configured on this server', 503);
    }
    // The JWT carries only { id, role }, so the email for the watermark comes
    // from the database.
    viewer = await User.findByPk(req.user.id, { attributes: ['email'] });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }

  let settled = false;
  const fail = (status, message) => {
    if (settled) return;
    settled = true;
    if (!res.headersSent) return res.status(status).json({ message });
    res.destroy();
  };

  fetchFollowing(
    signedNoteUrl(note.storage_public_id, note.file_url),
    2,
    (upstream) => {
      if (upstream.statusCode !== 200) {
        upstream.resume();
        return fail(502, 'Could not retrieve the note file');
      }

      const chunks = [];
      upstream.on('data', (chunk) => chunks.push(chunk));
      upstream.on('error', () => fail(502, 'Could not retrieve the note file'));

      upstream.on('end', async () => {
        if (settled) return;

        let output;
        try {
          output = await watermarkPdf(Buffer.concat(chunks), {
            email: viewer?.email,
            noteTitle: note.title,
          });
        } catch (err) {
          // Fail closed. Serving the unstamped original on error would quietly
          // hand out exactly the untraceable copy the watermark exists to
          // prevent, and the failure would go unnoticed.
          console.error(`Watermarking failed for note ${note.id}:`, err.message);
          return fail(500, 'This note could not be prepared for viewing');
        }

        settled = true;

        res.set({
          // Set from what we know, not from upstream: Cloudinary serves raw
          // assets as application/octet-stream, which the browser downloads
          // instead of displaying.
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${encodeURIComponent(note.title)}.pdf"`,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Content-Length': output.length,
        });

        res.end(output);
      });
    },
    () => fail(504, 'Timed out retrieving the note file')
  );
};
