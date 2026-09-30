/**
 * Adds (or, with --down, removes) question_progress.practice_scope.
 *
 *   npm run db:migrate-practice-scope
 *   npm run db:migrate-practice-scope -- --down
 *
 * The SQL lives in migrations/20260930120000_add_practice_scope_to_question_progress.sql;
 * this runs its UP or DOWN section in one transaction. Safe to re-run.
 *
 * Run it BEFORE the API that reads practice_scope goes live — see DEPLOY.md.
 */
import { readFileSync } from 'node:fs';
import { sequelize } from '../src/models/index.js';

const MIGRATION_PATH = new URL(
  '../migrations/20260930120000_add_practice_scope_to_question_progress.sql',
  import.meta.url
);

const getSection = (sql, name) => {
  const [, afterUp] = sql.split('-- UP');
  const [up, down] = afterUp.split('-- DOWN');
  return name === 'UP' ? up : down;
};

const run = async () => {
  const isDown = process.argv.includes('--down');
  const section = getSection(readFileSync(MIGRATION_PATH, 'utf8'), isDown ? 'DOWN' : 'UP');

  await sequelize.authenticate();
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(section, { transaction });
  });

  // The old unique index is dropped by its Sequelize-generated name. If an
  // environment ever named it differently it would survive the UP and reject
  // every "All subjects" answer to a question already answered by subject, so
  // look for any unique index still on exactly (user_id, question_id).
  if (!isDown) {
    const [leftover] = await sequelize.query(`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'question_progress'
         AND indexdef ILIKE 'CREATE UNIQUE INDEX%(user_id, question_id)'`);
    if (leftover.length) {
      throw new Error(
        `Old unique index still present: ${leftover.map((r) => r.indexname).join(', ')} — drop it by hand`
      );
    }
  }

  console.log(isDown ? 'removed  question_progress.practice_scope' : 'added    question_progress.practice_scope');
  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
