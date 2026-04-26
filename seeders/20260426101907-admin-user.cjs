'use strict';
const bcrypt = require('bcrypt');
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const existingAdmin = await queryInterface.sequelize.query(
          `SELECT id FROM users WHERE email = 'admin@amc.com' LIMIT 1;`
        );

        if (existingAdmin[0].length > 0) {
          console.log('⚠️ Admin already exists, skipping...');
          return;
        }

        const hashedPassword = await bcrypt.hash('admin123', 10);

        await queryInterface.bulkInsert('users', [{
          full_name: 'Admin User',
          email: 'admin@amc.com',
          password: hashedPassword,
          role: 'admin',
          created_at: new Date(),
          updated_at: new Date(),
        }]);

        console.log('✅ Admin seeded');
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('users', {
      email: 'admin@amc.com'
    });
  }
};
