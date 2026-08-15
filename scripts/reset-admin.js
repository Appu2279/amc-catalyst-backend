/**
 * Create or reset the admin account.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<strong password>' npm run admin:reset
 *
 * The password is never stored in the repo — it comes from the environment and
 * only the bcrypt hash reaches the database. Run this once per environment.
 */
import bcrypt from 'bcrypt';
import { User, sequelize } from '../src/models/index.js';

const MIN_PASSWORD_LENGTH = 12;

const run = async () => {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD, e.g.');
    console.error("  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run admin:reset");
    process.exit(1);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ where: { email } });

  if (existing) {
    await existing.update({ password: hashed, role: 'admin' });
    console.log(`✅ Password reset for existing admin ${email}`);
  } else {
    await User.create({ fullName: 'Admin', email, password: hashed, role: 'admin' });
    console.log(`✅ Admin created: ${email}`);
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
