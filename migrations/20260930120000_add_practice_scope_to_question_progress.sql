-- Separates QBank "All subjects" practice progress from per-subject progress.
--
-- question_progress held one row per (user, question), so answering a question
-- under "All subjects" and under its own subject was the same record and both
-- cards counted it. practice_scope says where the answer was given:
--   'default'      Recall, and QBank practised subject by subject
--   'all_subjects' QBank practised as the whole bank
-- Existing rows become 'default', so current progress is unchanged.
--
-- Run with: npm run db:migrate-practice-scope          (up)
--           npm run db:migrate-practice-scope -- --down (down)
-- Both sections are idempotent and each runs in one transaction.

-- UP
ALTER TABLE question_progress
  ADD COLUMN IF NOT EXISTS practice_scope VARCHAR(20) NOT NULL DEFAULT 'default';
DROP INDEX IF EXISTS question_progress_user_id_question_id;
CREATE UNIQUE INDEX IF NOT EXISTS question_progress_user_id_question_id_practice_scope
  ON question_progress (user_id, question_id, practice_scope);

-- DOWN
-- "All subjects" answers have no place in the old one-row-per-question shape,
-- so they are removed before the old unique index is restored.
DELETE FROM question_progress WHERE practice_scope <> 'default';
DROP INDEX IF EXISTS question_progress_user_id_question_id_practice_scope;
CREATE UNIQUE INDEX IF NOT EXISTS question_progress_user_id_question_id
  ON question_progress (user_id, question_id);
ALTER TABLE question_progress DROP COLUMN IF EXISTS practice_scope;
