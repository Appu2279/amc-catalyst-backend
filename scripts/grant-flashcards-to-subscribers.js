/**
 * Gives Flashcards to students who bought a plan before it included Flashcards.
 *
 *   npm run flashcards:grant-existing                          # dry run
 *   npm run flashcards:grant-existing -- --apply
 *   npm run flashcards:grant-existing -- --course-ids=1,4      # only these plans
 *   npm run flashcards:grant-existing -- --down --subscription-ids=12,15 [--apply]
 *
 * A subscription keeps the sections its plan had on the day it was bought (see
 * subscription.model.js), so ticking Flashcards on a course in Admin → Courses
 * only reaches new purchases. This adds 'flashcards' to the live subscriptions
 * of every course that now includes it — or only the courses passed with
 * --course-ids, which must already include Flashcards so existing and new
 * buyers of a plan get the same thing.
 *
 * Nothing is written without --apply. With --apply it prints the ids it
 * changed and the exact --down command that undoes it; --down removes
 * Flashcards from those subscriptions only, so it cannot touch anyone who got
 * Flashcards by buying a plan that already included it.
 */
import { Op } from 'sequelize';
import { sequelize, Course, Subscription } from '../src/models/index.js';
import { resolveCourseSections } from '../src/services/course.service.js';
import { SECTIONS, normaliseSections } from '../src/constants/sections.js';

const FLASHCARDS = SECTIONS.FLASHCARDS;

const getIdList = (name) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  const ids = arg.split('=')[1].split(',').map((v) => v.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) {
    throw new Error(`--${name} must be a comma-separated list of numbers, e.g. --${name}=1,4`);
  }
  return ids.map(Number);
};

const describe = (s) => `  #${String(s.id).padEnd(6)} user ${String(s.user_id).padEnd(6)} ${String(s.plan_title ?? '—').padEnd(24)} ends ${s.end_date.toISOString().slice(0, 10)}`;

/** Courses whose live subscribers should get Flashcards. */
const getTargetCourses = async (courseIds) => {
  const courses = await Course.findAll({
    where: courseIds ? { id: courseIds } : {},
    order: [['id', 'ASC']],
  });

  if (courseIds) {
    const missing = courseIds.filter((id) => !courses.some((c) => c.id === id));
    if (missing.length) throw new Error(`No course with id ${missing.join(', ')}`);
  }

  const withFlashcards = [];
  for (const course of courses) {
    if ((await resolveCourseSections(course)).includes(FLASHCARDS)) {
      withFlashcards.push(course);
    } else if (courseIds) {
      throw new Error(`"${course.title}" (id ${course.id}) does not include Flashcards. Tick it in Admin → Courses first.`);
    }
  }
  return withFlashcards;
};

const grant = async ({ isApply, courseIds }) => {
  const courses = await getTargetCourses(courseIds);
  if (!courses.length) {
    console.log('No course includes Flashcards yet. Tick Flashcards on a course in Admin → Courses, then run this again.');
    return;
  }
  console.log('Courses that include Flashcards:');
  for (const course of courses) console.log(`  ${course.id}  ${course.title}`);

  const live = await Subscription.findAll({
    where: {
      course_id: courses.map((c) => c.id),
      status: 'active',
      end_date: { [Op.gt]: new Date() },
    },
    order: [['id', 'ASC']],
  });

  // A null snapshot is a legacy row that grants nothing until it is backfilled
  // by db:migrate-entitlements; adding one section to it would hand out
  // Flashcards alone, so it is reported and left for that script.
  const legacy = live.filter((s) => !Array.isArray(s.granted_sections));
  const toGrant = live.filter((s) => Array.isArray(s.granted_sections) && !s.granted_sections.includes(FLASHCARDS));
  const alreadyHave = live.length - legacy.length - toGrant.length;

  console.log(`\nLive subscriptions on these courses: ${live.length}`);
  console.log(`  already have Flashcards: ${alreadyHave}`);
  console.log(`  will get Flashcards:     ${toGrant.length}`);
  for (const s of toGrant) console.log(describe(s));
  if (legacy.length) {
    console.log(`  SKIPPED, no section snapshot (run db:migrate-entitlements first): ${legacy.map((s) => `#${s.id}`).join(', ')}`);
  }

  if (!toGrant.length) return;
  if (!isApply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to grant.');
    return;
  }

  await sequelize.transaction(async (transaction) => {
    for (const s of toGrant) {
      await s.update({ granted_sections: normaliseSections([...s.granted_sections, FLASHCARDS]) }, { transaction });
    }
  });

  const ids = toGrant.map((s) => s.id).join(',');
  console.log(`\nGranted Flashcards to ${toGrant.length} subscription(s): ${ids}`);
  console.log('Keep this line. To undo exactly this change, run:');
  console.log(`  npm run flashcards:grant-existing -- --down --subscription-ids=${ids} --apply`);
};

const revoke = async ({ isApply, subscriptionIds }) => {
  if (!subscriptionIds) {
    throw new Error('--down needs --subscription-ids, the list printed when Flashcards was granted.');
  }

  const subscriptions = await Subscription.findAll({ where: { id: subscriptionIds }, order: [['id', 'ASC']] });
  const missing = subscriptionIds.filter((id) => !subscriptions.some((s) => s.id === id));
  if (missing.length) console.log(`Not found, skipped: ${missing.map((id) => `#${id}`).join(', ')}`);

  const toRevoke = subscriptions.filter((s) => Array.isArray(s.granted_sections) && s.granted_sections.includes(FLASHCARDS));
  console.log(`Will remove Flashcards from ${toRevoke.length} subscription(s):`);
  for (const s of toRevoke) console.log(describe(s));

  if (!toRevoke.length) return;
  if (!isApply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to remove.');
    return;
  }

  await sequelize.transaction(async (transaction) => {
    for (const s of toRevoke) {
      await s.update({ granted_sections: s.granted_sections.filter((key) => key !== FLASHCARDS) }, { transaction });
    }
  });
  console.log(`\nRemoved Flashcards from ${toRevoke.length} subscription(s).`);
};

const run = async () => {
  const isApply = process.argv.includes('--apply');
  await sequelize.authenticate();

  if (process.argv.includes('--down')) {
    await revoke({ isApply, subscriptionIds: getIdList('subscription-ids') });
  } else {
    await grant({ isApply, courseIds: getIdList('course-ids') });
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
