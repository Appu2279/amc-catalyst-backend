import fs from 'fs/promises';
import path from 'path';
import { Note } from '../models/index.js';
import { assertSectionAccess } from './entitlement.service.js';
import { SECTIONS } from '../constants/sections.js';
import { AppError } from '../utils/AppError.js';
import { uploadNoteBuffer, destroyObject } from '../config/storage.js';

const FOLDER = 'amc-catalyst/notes';

/**
 * The only columns that ever reach a non-admin browser.
 *
 * storage_public_id and file_url are deliberately absent. An S3 key in an API
 * response would be one more thing standing between "has this account paid"
 * and "can read this file" — the bucket is private, so nothing can actually be
 * fetched with it directly, but there is no reason to hand it out either. The
 * browser gets an id; the bytes come back through GET /api/notes/:id/file.
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
// Reads only the header rather than the whole file: rejecting a mislabelled
// 60MB file this way costs one disk read instead of reading and uploading the
// whole thing first.
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
 * No caller can reach the file except through getNoteForViewing(), and notes
 * are stored as private objects in a bucket with all public access blocked,
 * fetched server-side, so this check is the whole of the paywall — there is
 * no public URL to leak past it.
 */
const assertCanAccess = async (note, user) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (user.role === 'admin') return; // admins preview inactive notes
  if (!note.is_active) throw new AppError('Note not found', 404);

  // Samples stay open to any signed-in user — that is what is_free is for.
  if (note.is_free) return;

  await assertSectionAccess(SECTIONS.NOTES, user);
};

export const getNoteForViewing = async (id, user) => {
  const note = await Note.findByPk(id);
  if (!note) throw new AppError('Note not found', 404);
  await assertCanAccess(note, user);
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
 * Upload bytes to S3 and register the note. Shared by the admin upload
 * endpoint and scripts/upload-notes.js so both agree on validation, naming and
 * the private-object settings.
 *
 * Uploaded exactly as received — no compression, no downsampling. S3 has no
 * practical size ceiling for a PDF of the kind this app handles, so unlike the
 * old Cloudinary path there is nothing here trading image clarity for a
 * storage limit.
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

  const buffer = await fs.readFile(filePath);
  const key = `${FOLDER}/${slug}.pdf`;
  await uploadNoteBuffer(buffer, key);

  // Only fields the caller actually supplied are written. Re-uploading a file
  // to replace its PDF must not blank out a description or reset a title that
  // was edited after the original upload — the caller is replacing bytes, not
  // clearing metadata.
  return upsertNote(
    {
      storage_public_id: key,
      // Not a working URL — the bucket blocks public access, so this 403s if
      // opened directly. Kept only as a human-readable pointer to the object
      // for admin/debugging; the app always reads the object back by key.
      file_url: `s3://${process.env.S3_BUCKET}/${key}`,
      file_size_bytes: buffer.length,
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
  // S3 with nothing left pointing at it.
  await destroyObject(note.storage_public_id);
  await note.destroy();

  return { message: 'Note deleted' };
};
