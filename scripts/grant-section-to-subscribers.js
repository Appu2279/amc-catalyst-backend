/**
 * Gives a section to students who bought a plan before it included that section.
 *
 *   npm run flashcards:grant-existing                              # dry run
 *   npm run online-classes:grant-existing -- --apply
 *   npm run online-classes:grant-existing -- --course-ids=1,4      # only these plans
 *   npm run online-classes:grant-existing -- --down --subscription-ids=12,15 [--apply]
 *
 * Both npm scripts run this file with --section=<key> (flashcards or
 * online_classes).
 *
 * A subscription keeps the sections its plan had on the day it was bought (see
 * subscription.model.js), so ticking a section on a course in Admin → Courses
 * only reaches new purchases. This adds the section to the live subscriptions
 * of every course that now includes it — or only the courses passed with
 * --course-ids, which must already include it so existing and new buyers of a
 * plan get the same thing.
 *
 * Nothing is written without --apply. With --apply it prints the ids it
 * changed and the exact --down command that undoes it; --down removes the
 * section from those subscriptions only, so it cannot touch anyone who got it
 * by buying a plan that already included it.
 */
import { Op } from 'sequelize';
import { sequelize, Course, Subscription } from '../src/models/index.js';
import { resolveCourseSections } from '../src/services/course.service.js';
import { isSectionKey, normaliseSections, SECTION_KEYS } from '../src/constants/sections.js';

const getSection = () => {
  const section = process.argv.find((a) => a.startsWith('--section='))?.split('=')[1];
  if (!isSectionKey(section)) {
    throw new Error(`--section must be one of: ${SECTION_KEYS.join(', ')}`);
  }
  return section;
};

// Set from --section at the start of run(), so a bad value is reported like every other error.
let SECTION;

// The npm script that wraps this file for each section, used in the printed undo command.
const NPM_SCRIPTS = Object.freeze({
  flashcards: 'flashcards:grant-existing',
  online_classes: 'online-classes:grant-existing',
});

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

/** Courses whose live subscribers should get the section. */
const getTargetCourses = async (courseIds) => {
  const courses = await Course.findAll({
    where: courseIds ? { id: courseIds } : {},
    order: [['id', 'ASC']],
  });

  if (courseIds) {
    const missing = courseIds.filter((id) => !courses.some((c) => c.id === id));
    if (missing.length) throw new Error(`No course with id ${missing.join(', ')}`);
  }

  const withSection = [];
  for (const course of courses) {
    if ((await resolveCourseSections(course)).includes(SECTION)) {
      withSection.push(course);
    } else if (courseIds) {
      throw new Error(`"${course.title}" (id ${course.id}) does not include ${SECTION}. Tick it in Admin → Courses first.`);
    }
  }
  return withSection;
};

const grant = async ({ isApply, courseIds }) => {
  const courses = await getTargetCourses(courseIds);
  if (!courses.length) {
    console.log(`No course includes ${SECTION} yet. Tick it on a course in Admin → Courses, then run this again.`);
    return;
  }
  console.log(`Courses that include ${SECTION}:`);
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
  // that one section alone, so it is reported and left for that script.
  const legacy = live.filter((s) => !Array.isArray(s.granted_sections));
  const toGrant = live.filter((s) => Array.isArray(s.granted_sections) && !s.granted_sections.includes(SECTION));
  const alreadyHave = live.length - legacy.length - toGrant.length;

  console.log(`\nLive subscriptions on these courses: ${live.length}`);
  console.log(`  already have ${SECTION}: ${alreadyHave}`);
  console.log(`  will get ${SECTION}:     ${toGrant.length}`);
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
      await s.update({ granted_sections: normaliseSections([...s.granted_sections, SECTION]) }, { transaction });
    }
  });

  const ids = toGrant.map((s) => s.id).join(',');
  console.log(`\nGranted ${SECTION} to ${toGrant.length} subscription(s): ${ids}`);
  console.log('Keep this line. To undo exactly this change, run:');
  const command = NPM_SCRIPTS[SECTION] ? `npm run ${NPM_SCRIPTS[SECTION]} --` : `node scripts/grant-section-to-subscribers.js --section=${SECTION}`;
  console.log(`  ${command} --down --subscription-ids=${ids} --apply`);
};

const revoke = async ({ isApply, subscriptionIds }) => {
  if (!subscriptionIds) {
    throw new Error(`--down needs --subscription-ids, the list printed when ${SECTION} was granted.`);
  }

  const subscriptions = await Subscription.findAll({ where: { id: subscriptionIds }, order: [['id', 'ASC']] });
  const missing = subscriptionIds.filter((id) => !subscriptions.some((s) => s.id === id));
  if (missing.length) console.log(`Not found, skipped: ${missing.map((id) => `#${id}`).join(', ')}`);

  const toRevoke = subscriptions.filter((s) => Array.isArray(s.granted_sections) && s.granted_sections.includes(SECTION));
  console.log(`Will remove ${SECTION} from ${toRevoke.length} subscription(s):`);
  for (const s of toRevoke) console.log(describe(s));

  if (!toRevoke.length) return;
  if (!isApply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to remove.');
    return;
  }

  await sequelize.transaction(async (transaction) => {
    for (const s of toRevoke) {
      await s.update({ granted_sections: s.granted_sections.filter((key) => key !== SECTION) }, { transaction });
    }
  });
  console.log(`\nRemoved ${SECTION} from ${toRevoke.length} subscription(s).`);
};

const run = async () => {
  SECTION = getSection();
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
