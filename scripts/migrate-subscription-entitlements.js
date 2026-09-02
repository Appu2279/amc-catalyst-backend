/**
 * One-off migration for subscription entitlements.
 *
 *   npm run db:create-new          # first — adds the new columns
 *   node scripts/migrate-subscription-entitlements.js
 *
 * Two things create-new-tables.js cannot do, because it only ever ADDS columns:
 *
 *   1. Add 'revoked' to the subscriptions.status enum. That is a change to an
 *      existing type, not a new column.
 *   2. Backfill the snapshot columns on subscriptions that already exist.
 *
 * The backfill matters more than it looks. Once access is resolved from
 * `granted_sections`, a row with none grants nothing — so every subscription
 * sold before this migration would go dark the moment the entitlement check
 * ships. This copies each one's current course definition onto the row, which
 * is the best available reconstruction of what those buyers were sold.
 *
 * Safe to run repeatedly: the enum value is added IF NOT EXISTS, and only rows
 * with a null snapshot are touched.
 */
import { sequelize, Subscription, Course } from '../src/models/index.js';
import { resolveCourseSections } from '../src/services/course.service.js';

const addRevokedStatus = async () => {
  // ALTER TYPE ... ADD VALUE cannot run inside a transaction on older Postgres,
  // so this goes out on its own rather than being wrapped with the backfill.
  await sequelize.query(
    "ALTER TYPE \"enum_subscriptions_status\" ADD VALUE IF NOT EXISTS 'revoked'"
  );
  console.log("ok       subscriptions.status accepts 'revoked'");
};

const backfillSnapshots = async () => {
  const pending = await Subscription.findAll({ where: { granted_sections: null } });

  if (pending.length === 0) {
    console.log('ok       no subscriptions need a snapshot');
    return;
  }

  console.log(`         ${pending.length} subscription(s) without a snapshot`);

  let filled = 0;
  const orphaned = [];

  for (const subscription of pending) {
    // course_id is ON DELETE SET NULL, so a subscription whose plan was deleted
    // before this migration has nothing left to reconstruct from. Report those
    // rather than guessing — someone has to decide what those users bought.
    if (!subscription.course_id) {
      orphaned.push(subscription.id);
      continue;
    }

    const course = await Course.findByPk(subscription.course_id);
    if (!course) {
      orphaned.push(subscription.id);
      continue;
    }

    const sections = await resolveCourseSections(course);

    await subscription.update({
      granted_sections: sections,
      plan_title: subscription.plan_title ?? course.title,
    });

    filled += 1;

    if (sections.length === 0) {
      console.log(
        `warn     subscription #${subscription.id} -> "${course.title}" grants no ` +
          'sections; set them on the course and re-run'
      );
    }
  }

  console.log(`ok       ${filled} subscription(s) snapshotted`);

  if (orphaned.length) {
    console.log(
      `WARNING  ${orphaned.length} subscription(s) have no course and cannot be ` +
        `reconstructed automatically: #${orphaned.join(', #')}`
    );
  }
};

const reportUnconfiguredCourses = async () => {
  const courses = await Course.findAll();
  const empty = [];

  for (const course of courses) {
    const sections = await resolveCourseSections(course);
    if (sections.length === 0) empty.push(course.title);
  }

  if (empty.length === 0) return;

  console.log();
  console.log('WARNING  These plans grant no sections and cannot be sold until they do:');
  for (const title of empty) console.log(`           - ${title}`);
  console.log('         Set `sections` on each (notes, qbank, recall, mocks).');
};

/**
 * notes.is_free used to default to true, from when every note was free. Now
 * that notes are sold, a note uploaded without an explicit flag should be paid.
 * Only the default moves — existing rows keep whatever they were set to.
 */
const flipNotesDefault = async () => {
  await sequelize.query('ALTER TABLE "notes" ALTER COLUMN "is_free" SET DEFAULT false');
  console.log('ok       notes.is_free now defaults to false');
};

const run = async () => {
  await sequelize.authenticate();

  await addRevokedStatus();
  await flipNotesDefault();
  await backfillSnapshots();
  await reportUnconfiguredCourses();

  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
