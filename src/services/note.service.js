import fs from 'fs/promises';
import path from 'path';
import { Note } from '../models/index.js';
import { compressToFit } from './compress.service.js';
import { AppError } from '../utils/AppError.js';
import { uploadNoteBuffer, destroyNoteAsset } from '../config/cloudinary.js';

const FOLDER = 'amc-catalyst/notes';

/**
 * The only columns that ever reach a non-admin browser.
 *
 * storage_public_id and file_url are deliberately absent. A Cloudinary URL in
 * an API response is a permanent, unauthenticated way to read the file — it
 * would outlive the user's session, survive logout, and work for anyone it is
 * forwarded to. The browser gets an id; the bytes come back through
 * GET /api/notes/:id/file.
 */
const PUBLIC_ATTRIBUTES = [
  'id',
  'title',
  'description',
  'page_count',
  'is_free',
  'createdAt',
];

// Admins see the same columns plus the moderation ones, and the file size —
// which students have no use for, so it is absent from the list above rather
// than merely hidden in the UI. Still no storage URL: an admin has no use for
// it that the app does not already cover, and it would end up pasted into a
// chat sooner or later.
const ADMIN_ATTRIBUTES = [
  ...PUBLIC_ATTRIBUTES,
  'file_size_bytes',
  'sort_order',
  'is_active',
  'updatedAt',
];

/**
 * Shapes a Note instance for an admin response.
 *
 * Create and update return the model instance, which carries storage_public_id
 * and file_url. Those must not be serialised to the client for the same reason
 * they are absent from the attribute lists above, and toJSON() would happily
 * include them.
 */
export const toAdminView = (note) =>
  Object.fromEntries(ADMIN_ATTRIBUTES.map((key) => [key, note[key]]));

// ── Helpers ───────────────────────────────────────────────────────────────────

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// "cardiology-basics.pdf" -> "Cardiology Basics"
export const titleFromFilename = (name) =>
  name
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Best-effort page count, read from the page tree's /Count entry.
 *
 * Returns null when the PDF stores its page tree in a compressed object stream,
 * which this cannot read without a full parser. The column is nullable and the
 * UI omits the count when it is missing, so a null here is not an error — it is
 * not worth a PDF-parsing dependency to close the gap.
 */
const bestEffortPageCount = (buffer) => {
  const counts = [...buffer.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) =>
    parseInt(m[1], 10)
  );
  return counts.length ? Math.max(...counts) : null;
};

// Checked by content, not by extension or the browser's Content-Type: both are
// caller-supplied, and a mislabelled file would upload happily and then fail in
// the PDF viewer with no clue why.
//
// Reads only the header rather than the whole file: this runs before
// compression, so rejecting a mislabelled 60MB file costs one disk read instead
// of a minute of Ghostscript.
const assertFileIsPdf = async (filePath) => {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(5), 0, 5, 0);
    if (bytesRead < 5 || !buffer.toString('latin1').startsWith('%PDF-')) {
      throw new AppError('That file is not a PDF', 400);
    }
  } finally {
    await handle?.close();
  }
};

// ── Reads ─────────────────────────────────────────────────────────────────────

export const listNotes = () =>
  Note.findAll({
    where: { is_active: true },
    attributes: PUBLIC_ATTRIBUTES,
    order: [
      ['sort_order', 'ASC'],
      ['title', 'ASC'],
    ],
  });

export const listNotesAdmin = () =>
  Note.findAll({
    attributes: ADMIN_ATTRIBUTES,
    order: [
      ['sort_order', 'ASC'],
      ['title', 'ASC'],
    ],
  });

/**
 * The single place note access is decided.
 *
 * Today every registered user may read every note, so this only rejects
 * anonymous callers. When notes become subscription-only, this is the function
 * to change — check the user's Subscription here and reject when `is_free` is
 * false. Nothing else needs to move, because no caller can reach the file
 * except through getNoteForViewing().
 */
const assertCanAccess = (note, user) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (user.role === 'admin') return; // admins preview inactive notes
  if (!note.is_active) throw new AppError('Note not found', 404);
  if (note.is_free) return;
  throw new AppError('This note requires an active subscription', 403);
};

export const getNoteForViewing = async (id, user) => {
  const note = await Note.findByPk(id);
  if (!note) throw new AppError('Note not found', 404);
  assertCanAccess(note, user);
  return note;
};

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Keyed on storage_public_id so re-uploading the same filename updates its row
 * instead of adding a second copy — re-running the upload script after fixing a
 * title is a normal thing to do, and should not leave duplicates behind.
 */
export const upsertNote = async (fields, createDefaults = {}) => {
  const existing = await Note.findOne({
    where: { storage_public_id: fields.storage_public_id },
  });

  if (existing) {
    await existing.update(fields);
    return { note: existing, created: false };
  }

  return { note: await Note.create({ ...createDefaults, ...fields }), created: true };
};

/**
 * Upload bytes to Cloudinary and register the note. Shared by the admin upload
 * endpoint and scripts/upload-notes.js so both agree on validation, naming and
 * the private-asset settings.
 */
export const publishNote = async ({
  filePath,
  filename,
  title,
  description,
  sort_order,
  created_by,
}) => {
  await assertFileIsPdf(filePath);

  const base = path.basename(filename);
  const slug = slugify(base);
  if (!slug) throw new AppError('Could not derive a filename for this note', 400);

  // Oversized PDFs are shrunk here rather than being rejected: Cloudinary caps
  // raw files at 10 MiB, and asking an admin to go and compress a file by hand
  // before every upload is work the server can do itself.
  const compression = await compressToFit(filePath);

  try {
    const buffer = await fs.readFile(compression.path);
    const result = await uploadNoteBuffer(buffer, `${FOLDER}/${slug}`);

    // Only fields the caller actually supplied are written. Re-uploading a file
    // to replace its PDF must not blank out a description or reset a title that
    // was edited after the original upload — the caller is replacing bytes, not
    // clearing metadata.
    const outcome = await upsertNote(
      {
        // public_id straight from the response — for raw assets Cloudinary
        // appends the extension, and a hand-built id would not match at signing
        // time.
        storage_public_id: result.public_id,
        file_url: result.secure_url,
        file_size_bytes: result.bytes ?? buffer.length,
        page_count: bestEffortPageCount(buffer),
        is_active: true,
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(description === undefined ? {} : { description: description?.trim() || null }),
        ...(sort_order === undefined ? {} : { sort_order }),
        ...(created_by === undefined ? {} : { created_by }),
      },
      // title is NOT NULL, so a brand-new note always needs one.
      { title: titleFromFilename(base) }
    );

    return { ...outcome, compression };
  } finally {
    // Only the compressed copy is ours to delete; the source belongs to the
    // caller (multer's temp file, or a real file the upload script was given).
    if (compression.compressed) {
      await fs.unlink(compression.path).catch(() => {});
    }
  }
};

// Metadata only. Replacing a note's PDF is an upload, not an edit — that keeps
// storage_public_id and the stored bytes from drifting apart.
export const updateNote = async (id, { title, description, sort_order, is_active, is_free }) => {
  const note = await Note.findByPk(id);
  if (!note) throw new AppError('Note not found', 404);

  await note.update({
    ...(title === undefined ? {} : { title: title.trim() }),
    ...(description === undefined ? {} : { description: description?.trim() || null }),
    ...(sort_order === undefined ? {} : { sort_order }),
    ...(is_active === undefined ? {} : { is_active }),
    ...(is_free === undefined ? {} : { is_free }),
  });

  return note;
};

export const deleteNote = async (id) => {
  const note = await Note.findByPk(id);
  if (!note) throw new AppError('Note not found', 404);

  // Storage first: if this fails we still hold the row, so the orphan is
  // visible and retryable. Dropping the row first would strand a paid PDF in
  // Cloudinary with nothing left pointing at it.
  await destroyNoteAsset(note.storage_public_id);
  await note.destroy();

  return { message: 'Note deleted' };
};
