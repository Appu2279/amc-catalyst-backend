'use strict';

import bcrypt from 'bcrypt';

export async function up(queryInterface, Sequelize) {
  const hashedPassword = await bcrypt.hash('admin123', 10);

  await queryInterface.bulkInsert('users', [{
    email: 'admin@amc.com',
    password: hashedPassword,
    role: 'admin',
    created_at: new Date(),
    updated_at: new Date(),
  }]);
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.bulkDelete('users', {
    email: 'admin@amc.com'
  });
}