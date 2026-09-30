/**
 * Where a practice answer was given. Each scope keeps its own progress, so
 * working through QBank as the whole bank does not tick off questions on the
 * per-subject cards, and the other way round.
 */
export const PRACTICE_SCOPES = Object.freeze({
  DEFAULT: 'default',          // Recall, and QBank practised subject by subject
  ALL_SUBJECTS: 'all_subjects', // QBank practised as the whole bank
});

const PRACTICE_SCOPE_VALUES = Object.freeze(Object.values(PRACTICE_SCOPES));

export const isPracticeScope = (value) => PRACTICE_SCOPE_VALUES.includes(value);
