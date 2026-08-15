'use strict';
const bcrypt = require('bcrypt');

/**
 * Admin account.
 *
 * There is deliberately no default password here — a known credential in the
 * repo is a live admin account on every environment that runs the seeders.
 * Supply one through the environment:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='<strong password>' npm run db:seed
 *
 * Or reset it later with: npm run admin:reset
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const email = process.env.ADMIN_EMAIL?.trim();
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      console.log('⚠️  ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed.');
      console.log('    Create the admin with: npm run admin:reset');
      return;
    }

    if (password.length < 12) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    }

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1;',
      { replacements: { email } }
    );

    if (existing.length > 0) {
      console.log('⚠️  Admin already exists, skipping...');
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await queryInterface.bulkInsert('users', [{
      full_name: 'Admin',
      email,
      password: hashedPassword,
      role: 'admin',
      created_at: new Date(),
      updated_at: new Date(),
    }]);

    console.log(`✅ Admin seeded: ${email}`);
  },

  async down(queryInterface) {
    const email = process.env.ADMIN_EMAIL?.trim();
    if (!email) return;
    await queryInterface.bulkDelete('users', { email });
  },
};
