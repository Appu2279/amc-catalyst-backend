/**
 * Sets which sections each plan grants.
 *
 *   npm run db:set-sections
 *
 * Config, not schema, but it has to live somewhere runnable: a plan with no
 * sections cannot be sold (grantSubscription refuses it), so every environment
 * needs this applied before it can take a payment. Keyed by title rather than
 * id, because ids differ between environments and the titles are the pricing
 * cards.
 *
 * Each entry lists only what that plan ADDS. Tiered plans inherit the rest
 * through inherits_from_course_id — see resolveCourseSections() — which is why
 * Standard and Premium are empty here and still grant everything.
 *
 * Safe to re-run. Once the admin UI can edit sections this becomes a seed for
 * fresh environments rather than the way they are maintained.
 */
import { sequelize, Course } from '../src/models/index.js';
import { resolveCourseSections } from '../src/services/course.service.js';

/**
 * Derived from each plan's own advertised feature list, not from its name:
 *
 *   Notes Only            lists notes, recalls, MCQs/QBank and mock exams, so
 *                         despite the name it grants all four. "Notes Only"
 *                         distinguishes it from the eMedici tiers above it, not
 *                         from the rest of the product.
 *   Standard / Premium    add only eMedici access, which is a third-party
 *                         product this application does not serve. They add no
 *                         sections of their own and inherit all four.
 *   Recall + MCQ + Mock   lists recalls, MCQs/QBank and mocks, and pointedly no
 *                         notes — it is the cheap standalone practice plan.
 */
const SECTIONS_BY_PLAN = {
  'Notes Only': ['notes', 'qbank', 'recall', 'mocks'],
  Standard: [],
  Premium: [],
  'Recall + MCQ + Mock': ['qbank', 'recall', 'mocks'],
};

const run = async () => {
  await sequelize.authenticate();

  const courses = await Course.findAll({ order: [['sort_order', 'ASC']] });
  const unknown = courses.filter((c) => !(c.title in SECTIONS_BY_PLAN));

  for (const course of courses) {
    if (!(course.title in SECTIONS_BY_PLAN)) continue;

    const own = SECTIONS_BY_PLAN[course.title];
    await course.update({ sections: own });
    console.log(`set      ${course.title.padEnd(22)} own: ${JSON.stringify(own)}`);
  }

  console.log();
  console.log('Resolved access (what a buyer actually gets):');

  for (const course of await Course.findAll({ order: [['sort_order', 'ASC']] })) {
    const resolved = await resolveCourseSections(course);
    const flag = resolved.length === 0 ? '  <- CANNOT BE SOLD' : '';
    console.log(`  ${course.title.padEnd(22)} ${JSON.stringify(resolved)}${flag}`);
  }

  if (unknown.length) {
    console.log();
    console.log('WARNING  Plans not listed in this script, left untouched:');
    for (const course of unknown) console.log(`           - ${course.title}`);
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
