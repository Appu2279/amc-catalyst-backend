/**
 * Which part of the student dashboard a PDF in the `notes` table belongs to.
 *
 * All share the notes machinery (private storage, watermarked viewer, admin
 * upload) but are listed and gated separately:
 *
 *   notes        the Notes section; needs a plan that grants SECTIONS.NOTES.
 *   guidelines   the Guideline Updates section; open to anyone holding ANY
 *                live plan, whatever sections it grants.
 *   pathway      the Pathway Guide section; open to every signed-in user,
 *                like the rest of that page.
 *
 * In notes and guidelines, a row marked is_free is open to every signed-in user.
 */
export const NOTE_COLLECTIONS = Object.freeze({
  NOTES: 'notes',
  GUIDELINES: 'guidelines',
  PATHWAY: 'pathway',
});

export const NOTE_COLLECTION_KEYS = Object.freeze(Object.values(NOTE_COLLECTIONS));

export const isNoteCollection = (value) => NOTE_COLLECTION_KEYS.includes(value);
