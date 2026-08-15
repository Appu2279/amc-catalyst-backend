/**
 * Run every seeder in seeders/, in filename order.
 *
 *   npm run db:seed:run
 *
 * `npm run db:seed` shells out to sequelize-cli, which is a devDependency and
 * so absent from the production image. This calls each seeder's up() directly
 * with the same queryInterface, which works anywhere the app itself runs.
 *
 * The seeders are written to be idempotent: the course seeder clears only the
 * plan tables before inserting, and the admin seeder skips an account that
 * already exists.
 */
import { createRequire } from 'module';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sequelize } from '../src/models/index.js';

const require = createRequire(import.meta.url);
const seedersDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'seeders');

const run = async () => {
  await sequelize.authenticate();
  const queryInterface = sequelize.getQueryInterface();

  const files = readdirSync(seedersDir)
    .filter((f) => f.endsWith('.cjs') || f.endsWith('.js'))
    .sort();

  if (!files.length) {
    console.log('No seeders found.');
    await sequelize.close();
    return;
  }

  for (const file of files) {
    console.log(`→ ${file}`);
    const seeder = require(join(seedersDir, file));
    await seeder.up(queryInterface, sequelize.constructor);
  }

  console.log(`✅ Ran ${files.length} seeder(s)`);
  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
