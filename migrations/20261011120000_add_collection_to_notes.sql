-- Which dashboard section a PDF belongs to: 'notes' (Notes section) or
-- 'guidelines' (Guideline Updates, open to any plan). Existing rows get
-- 'notes', so nothing moves. Applied by `npm run db:create-new`; this file is
-- the reversible SQL equivalent. Approved by the user on 2026-10-11.

-- UP
ALTER TABLE notes ADD COLUMN IF NOT EXISTS collection VARCHAR(20) NOT NULL DEFAULT 'notes';

-- DOWN (delete or move any 'guidelines' rows first, or they become Notes)
ALTER TABLE notes DROP COLUMN IF EXISTS collection;
