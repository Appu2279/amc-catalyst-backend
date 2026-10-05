/**
 * Create tables that exist in the models but not yet in the database.
 *
 *   npm run db:create-new
 *
 * For deploying a feature that adds a table to an environment where
 * `sequelize.sync()` never runs — production, where server.js deliberately
 * skips it so a model/database drift cannot rewrite live columns on boot.
 *
 * Safe to run repeatedly and safe to run on a database with data: each model is
 * sync()'d WITHOUT `alter`, which issues CREATE TABLE IF NOT EXISTS and nothing
 * else. It never adds, drops or retypes a column on a table that already
 * exists — if you need that, take a dump and write a migration.
 *
 * Add a model here when you introduce one; remove it once the table exists
 * everywhere and the entry is just noise.
 */
import {
  sequelize,
  Note,
  QuestionProgress,
  ImportBatch,
  PaymentClaim,
  Course,
  Subscription,
  Question,
  MockTest,
  Subject,
  LiveExam,
  User,
} from '../src/models/index.js';

const MODELS = [
  ['notes', Note],
  ['question_progress', QuestionProgress],
  ['payment_claims', PaymentClaim],
  // Live (scheduled, results-later) exams. Undo: DROP TABLE live_exams;
  ['live_exams', LiveExam],
];

/**
 * Columns added to tables that already exist. sync() creates missing tables but
 * never touches an existing one, so a new column on an old table needs adding
 * explicitly. Each entry is checked before it is added, so this is safe to
 * re-run.
 */
const COLUMNS = [
  ['import_batches', 'is_visible', ImportBatch],

  // Entitlements. `courses.sections` is the editable definition of a plan;
  // the three `subscriptions` columns are the snapshot taken when one is sold,
  // which is what actually decides access. See subscription.model.js.
  ['courses', 'sections', Course],
  ['subscriptions', 'granted_sections', Subscription],
  ['subscriptions', 'plan_title', Subscription],
  ['subscriptions', 'source', Subscription],
  ['subscriptions', 'granted_by', Subscription],

  // Free samples. Opt-in per row, so both default to false and nothing becomes
  // readable that was not already.
  ['questions', 'is_free', Question],
  ['mock_tests', 'is_free', MockTest],
  ['import_batches', 'is_free', ImportBatch],

  // AMC blueprint domain for weighted mocks. Nullable: an unassigned subject is
  // simply left out of weighted mocks. Fill existing rows with
  // `npm run db:set-exam-domains`. Undo: ALTER TABLE subjects DROP COLUMN exam_domain;
  ['subjects', 'exam_domain', Subject],

  // Admin user controls: ban (timed or permanent) and soft delete. All
  // nullable, so every existing account stays active and visible.
  // Undo: migrations/20261006120000_add_ban_and_soft_delete_to_users.sql (DOWN).
  ['users', 'banned_at', User],
  ['users', 'banned_until', User],
  ['users', 'ban_reason', User],
  ['users', 'deleted_at', User],

  // WhatsApp number, collected at registration. Nullable: existing accounts
  // have none until they add it from their profile.
  // Undo: migrations/20261006130000_add_phone_to_users.sql (DOWN).
  ['users', 'phone', User],

  // Planned AMC exam date, set from the profile. Nullable.
  // Undo: migrations/20261006140000_add_amc_exam_date_to_users.sql (DOWN).
  ['users', 'amc_exam_date', User],
];

const run = async () => {
  await sequelize.authenticate();

  for (const [label, model] of MODELS) {
    const existedBefore = await sequelize
      .getQueryInterface()
      .showAllTables()
      .then((tables) => tables.includes(label));

    await model.sync();

    console.log(existedBefore ? `exists   ${label}` : `created  ${label}`);
  }

  for (const [table, column, model] of COLUMNS) {
    const described = await sequelize.getQueryInterface().describeTable(table);

    if (described[column]) {
      console.log(`exists   ${table}.${column}`);
      continue;
    }

    await sequelize
      .getQueryInterface()
      .addColumn(table, column, model.getAttributes()[column]);
    console.log(`added    ${table}.${column}`);
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
