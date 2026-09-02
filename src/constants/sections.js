/**
 * The parts of the product a plan can grant access to.
 *
 * These are entitlement keys, not marketing copy. Feature/Benefit rows are the
 * bullet points on a pricing card ("2500+ Structured MCQs", "Telegram
 * Community") and are written for humans; these four decide what the server
 * will actually serve. Keep them apart — a copy edit to a pricing card must
 * never change who can open a mock exam.
 *
 * Adding a section here is not enough to protect it. The matching service has
 * to call assertSectionAccess() as well, or the key is decorative.
 */
export const SECTIONS = Object.freeze({
  NOTES: 'notes',
  QBANK: 'qbank',
  RECALL: 'recall',
  MOCKS: 'mocks',
});

export const SECTION_KEYS = Object.freeze(Object.values(SECTIONS));

export const isSectionKey = (value) => SECTION_KEYS.includes(value);

/**
 * Narrows arbitrary input to known section keys, de-duplicated and in a stable
 * order.
 *
 * Used on the way in (admin edits a plan) and on the way out (reading a
 * subscription snapshot written by an older version of the code). An unknown
 * key is dropped rather than rejected: a section that was renamed or removed
 * should quietly stop granting anything, not break every existing
 * subscription that still mentions it.
 */
export const normaliseSections = (value) => {
  if (!Array.isArray(value)) return [];
  return SECTION_KEYS.filter((key) => value.includes(key));
};
