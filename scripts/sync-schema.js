/**
 * Create the schema from the models.
 *
 *   npm run db:sync
 *
 * Deliberately a manual command rather than something that runs on boot: in
 * production, `sequelize.sync({ alter: true })` on every restart can rewrite or
 * drop live columns the moment a model and the database drift apart.
 *
 * Use it to stand up an empty database. On one that already holds data, take a
 * dump first — `alter` is not a migration tool and will not preserve anything
 * it decides to change.
 */
import { sequelize } from '../src/models/index.js';

const run = async () => {
  const alter = process.argv.includes('--alter');

  await sequelize.authenticate();

  const [tables] = await sequelize.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public';"
  );

  if (tables[0].n > 0 && !alter) {
    console.error(
      `Refusing to run: this database already has ${tables[0].n} tables.\n` +
      'Pass --alter to modify an existing schema, after taking a backup.'
    );
    await sequelize.close();
    process.exit(1);
  }

  await sequelize.sync({ alter });
  console.log(`✅ Schema ${alter ? 'synced' : 'created'}`);
  await sequelize.close();
};

run().catch(async (err) => {
  console.error('Failed:', err.message);
  await sequelize.close();
  process.exit(1);
});
