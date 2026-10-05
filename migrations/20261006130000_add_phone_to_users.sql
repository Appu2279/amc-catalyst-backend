-- WhatsApp number collected at registration, stored in E.164 form (+61412345678).
-- Nullable: accounts created before this have none until they add it from
-- their profile. Applied by `npm run db:create-new`; this file is the
-- reversible SQL equivalent. Approved by the sign-off group on 2026-10-06.

-- UP
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- DOWN
ALTER TABLE users DROP COLUMN IF EXISTS phone;
