-- Admin user controls: ban (timed or permanent) and soft delete.
--
--   banned_at     when the ban was applied; null = not banned
--   banned_until  when a timed ban lifts itself; null with banned_at set = permanent
--   ban_reason    shown to the admin team, and to the user when they try to sign in
--   deleted_at    soft delete; the account cannot sign in but its data is kept
--
-- All nullable, so every existing account stays active and visible.
-- Applied by `npm run db:create-new` (scripts/create-new-tables.js); this file is
-- the reversible SQL equivalent. Approved by the sign-off group on 2026-10-06.

-- UP
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- DOWN
-- Lifts every ban and restores every removed account.
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE users DROP COLUMN IF EXISTS ban_reason;
ALTER TABLE users DROP COLUMN IF EXISTS banned_until;
ALTER TABLE users DROP COLUMN IF EXISTS banned_at;
