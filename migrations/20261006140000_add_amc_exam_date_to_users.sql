-- When the student plans to sit the AMC exam, set from their profile. Optional.
-- Applied by `npm run db:create-new`; this file is the reversible SQL
-- equivalent. Approved by the sign-off group on 2026-10-06.

-- UP
ALTER TABLE users ADD COLUMN IF NOT EXISTS amc_exam_date DATE;

-- DOWN
ALTER TABLE users DROP COLUMN IF EXISTS amc_exam_date;
