import fs from 'fs/promises';
import * as NoteService from '../services/note.service.js';
import { watermarkPdf } from '../services/watermark.service.js';
import { User } from '../models/index.js';
import { getObjectBuffer, isStorageConfigured } from '../config/storage.js';
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
    const { note, created } = await NoteService.publishNote({
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

    return NoteService.toAdminView(note);
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
 * GET /api/notes/:id/file
 *
 * Returns the PDF through the backend so the S3 object never reaches the
 * browser directly — the same reasoning as the image proxy in
 * image.routes.js, and the reason notes are stored as private objects in a
 * bucket with all public access blocked.
 *
 * Every copy is watermarked with the requesting account's email before it is
 * sent. That means the response is built in memory rather than piped straight
 * through: the whole document has to be present to stamp it. At a few MB per
 * note that is a fine trade for having every leaked copy identify its source.
 *
 * View-only posture:
 *   • Content-Disposition: inline  → opens in the viewer, no "Save as" prompt
 *   • Cache-Control: no-store      → not written to the browser's disk cache
 *   • The object is fetched server-side with the app's own AWS credentials —
 *     there is no URL, signed or otherwise, that ever reaches the client.
 */
export const streamNoteFile = async (req, res) => {
  let note;
  let viewer;

  // Everything that can fail with a status code happens before the first byte
  // is written — once the response starts, res.status() is a silent no-op.
  try {
    note = await NoteService.getNoteForViewing(req.params.id, req.user);
    if (!isStorageConfigured) {
      throw new AppError('File storage is not configured on this server', 503);
    }
    // The JWT carries only { id, role }, so the email for the watermark comes
    // from the database.
    viewer = await User.findByPk(req.user.id, { attributes: ['email'] });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message });
  }

  let source;
  try {
    source = await getObjectBuffer(note.storage_public_id);
  } catch (err) {
    console.error(`Fetching note ${note.id} from storage failed:`, err.message);
    return res.status(502).json({ message: 'Could not retrieve the note file' });
  }

  let output;
  try {
    output = await watermarkPdf(source.buffer, {
      email: viewer?.email,
      noteTitle: note.title,
    });
  } catch (err) {
    // Fail closed. Serving the unstamped original on error would quietly hand
    // out exactly the untraceable copy the watermark exists to prevent, and
    // the failure would go unnoticed.
    console.error(`Watermarking failed for note ${note.id}:`, err.message);
    return res.status(500).json({ message: 'This note could not be prepared for viewing' });
  }

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${encodeURIComponent(note.title)}.pdf"`,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': output.length,
  });

  res.end(output);
};
