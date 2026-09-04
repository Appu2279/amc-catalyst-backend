import { Op } from 'sequelize';
import { sequelize, Course, CoursePricing, Feature, Benefit, Subscription, User, PaymentClaim } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { normaliseSections } from '../constants/sections.js';

const courseIncludes = [
  CoursePricing,
  Feature,
  Benefit,
  // Tiered plans render as "Everything in <parent> PLUS …", so the card needs
  // the parent's title. One level only — no recursion.
  { model: Course, as: 'inherits_from', attributes: ['id', 'title'] },
];

export const getCourses = () =>
  Course.findAll({
    include: courseIncludes,
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
  });

export const getCourseById = async (id) => {
  const course = await Course.findByPk(id, { include: courseIncludes });
  if (!course) throw new AppError('Course not found', 404);
  return course;
};

// A tier chain is two or three deep in practice. The cap is here so a plan
// accidentally set to inherit from itself cannot spin forever.
const MAX_INHERITANCE_DEPTH = 10;

/**
 * Every section a course grants, flattened through its inheritance chain.
 *
 * Tiered plans list only what they add — "Premium" carries its own extras and
 * inherits the rest from "Standard" — so the sections a buyer actually gets are
 * the union along that chain. Resolved once, at grant time, and stored on the
 * subscription; nothing reads it again afterwards.
 */
export const resolveCourseSections = async (course, { transaction } = {}) => {
  const collected = new Set();
  const visited = new Set();

  let current = course;
  let depth = 0;

  while (current && depth < MAX_INHERITANCE_DEPTH) {
    if (visited.has(current.id)) break; // self-referential or looped tiering
    visited.add(current.id);

    for (const section of normaliseSections(current.sections)) collected.add(section);

    if (!current.inherits_from_course_id) break;
    current = await Course.findByPk(current.inherits_from_course_id, { transaction });
    depth += 1;
  }

  return normaliseSections([...collected]);
};

/**
 * Grants a user access to a course. Admin-only, and deliberately so.
 *
 * There is no self-service path to an active subscription: payment is taken by
 * QR transfer and confirmed by hand, so the only thing that may create one is
 * an admin who has checked the money actually arrived. This used to be reachable
 * as POST /courses/subscribe by any logged-in user, which granted any plan for
 * free to anyone who asked for it.
 */
export const grantSubscription = async (
  userId,
  courseId,
  { grantedBy, source = 'manual', transaction } = {}
) => {
  const [user, course] = await Promise.all([
    User.findByPk(userId, { transaction }),
    Course.findByPk(courseId, { transaction }),
  ]);

  if (!user) throw new AppError('User not found', 404);
  if (!course) throw new AppError('Course not found', 404);

  // Granting a second active subscription to the same course would leave two
  // rows disagreeing about when access ends. Extending an existing one is a
  // different operation and needs its own decision about the new end date.
  // Excludes expired rows deliberately: status stays 'active' forever once
  // set (nothing flips it — see entitlement.service.js, access is decided
  // live from end_date on every check), so this must filter end_date the
  // same way or a lapsed plan would permanently block its own renewal.
  const existing = await Subscription.findOne({
    where: {
      user_id: userId,
      course_id: courseId,
      status: 'active',
      end_date: { [Op.gt]: new Date() },
    },
    transaction,
  });
  if (existing) {
    throw new AppError('This user already has an active subscription to this course', 409);
  }

  const grantedSections = await resolveCourseSections(course, { transaction });

  // Refusing here rather than creating a subscription that grants nothing. A
  // plan with no sections is almost always one nobody has configured yet, and
  // the failure is otherwise invisible until the buyer logs in and finds an
  // empty account.
  if (grantedSections.length === 0) {
    throw new AppError(
      `"${course.title}" does not grant access to any section yet. Set its sections before selling it.`,
      409
    );
  }

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + course.duration_months);

  // Everything the buyer is owed is copied onto the row here and never read
  // from the Course again. Editing or retiring the plan tomorrow leaves this
  // subscription exactly as sold.
  return Subscription.create({
    user_id: userId,
    course_id: courseId,
    start_date: startDate,
    end_date: endDate,
    status: 'active',
    granted_sections: grantedSections,
    plan_title: course.title,
    granted_by: grantedBy ?? null,
    source,
  }, { transaction });
};

export const getMyCourses = (userId) =>
  Subscription.findAll({
    where: { user_id: userId },
    include: [{ model: Course, include: courseIncludes }],
  });

export const createCourse = async ({ title, description, duration_months, is_active, sections, pricing, feature_ids, benefit_ids }) => {
  const t = await sequelize.transaction();
  try {
    const course = await Course.create(
      {
        title,
        description,
        duration_months,
        is_active,
        // Narrowed to known keys so a typo in the admin form cannot write a
        // section that grants nothing and is never noticed.
        ...(sections === undefined ? {} : { sections: normaliseSections(sections) }),
      },
      { transaction: t }
    );

    if (pricing) {
      await CoursePricing.create(
        { course_id: course.id, actual_price: pricing[0].actual_price, discounted_price: pricing[0].discounted_price, is_early_bird: pricing[0].is_early_bird || false },
        { transaction: t }
      );
    }

    if (feature_ids?.length) {
      const features = await Feature.findAll({ where: { id: feature_ids } });
      await course.setFeatures(features, { transaction: t });
    }

    if (benefit_ids?.length) {
      const benefits = await Benefit.findAll({ where: { id: benefit_ids } });
      await course.setBenefits(benefits, { transaction: t });
    }

    await t.commit();
    return Course.findByPk(course.id, { include: courseIncludes });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

export const updateCourse = async (id, { title, description, duration_months, is_active, sections, pricing, feature_ids, benefit_ids }) => {
  const course = await Course.findByPk(id);
  if (!course) throw new AppError('Course not found', 404);

  const t = await sequelize.transaction();
  try {
    await course.update(
      {
        title,
        description,
        duration_months,
        is_active,
        // Omitted rather than nulled when absent: editing a plan's title must
        // not silently strip the sections it grants. Narrowed to known keys so
        // a typo cannot write a section that grants nothing.
        ...(sections === undefined ? {} : { sections: normaliseSections(sections) }),
      },
      { transaction: t }
    );

    if (pricing !== undefined) {
      await CoursePricing.destroy({ where: { course_id: id }, transaction: t });
      if (pricing) {
        await CoursePricing.create(
          { course_id: id, actual_price: pricing[0].actual_price, discounted_price: pricing[0].discounted_price, is_early_bird: pricing[0].is_early_bird || false },
          { transaction: t }
        );
      }
    }

    if (feature_ids !== undefined) {
      const features = await Feature.findAll({ where: { id: feature_ids || [] } });
      await course.setFeatures(features, { transaction: t });
    }

    if (benefit_ids !== undefined) {
      const benefits = await Benefit.findAll({ where: { id: benefit_ids || [] } });
      await course.setBenefits(benefits, { transaction: t });
    }

    await t.commit();
    return Course.findByPk(id, { include: courseIncludes });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * Hard-deletes a course, and refuses to when anything depends on it.
 *
 * The foreign keys from subscriptions and course_pricings are ON DELETE SET
 * NULL, so without this check destroying a course would silently blank the
 * course_id on every subscription sold against it. Those rows stay 'active'
 * with a future end_date while pointing at nothing, and no record survives of
 * which plan they were — paying users lose access, months after the click that
 * caused it, with no error connecting the two.
 *
 * Retiring a plan is what admins almost always mean, and that is is_active:
 * false — the pricing card disappears, existing subscribers are untouched.
 * Deletion is reserved for a course created by mistake that nobody ever bought.
 */
export const deleteCourse = async (id) => {
  const course = await Course.findByPk(id);
  if (!course) throw new AppError('Course not found', 404);

  const [subscriptions, claims, tiers] = await Promise.all([
    Subscription.count({ where: { course_id: id } }),
    PaymentClaim.count({ where: { course_id: id } }),
    Course.count({ where: { inherits_from_course_id: id } }),
  ]);

  if (subscriptions || claims || tiers) {
    const blockers = [
      subscriptions && `${subscriptions} subscription(s)`,
      claims && `${claims} payment claim(s)`,
      tiers && `${tiers} plan(s) inheriting from it`,
    ].filter(Boolean);

    throw new AppError(
      `"${course.title}" cannot be deleted because it has ${blockers.join(', ')}. ` +
        'Set is_active to false to retire it instead — that hides the plan from ' +
        'pricing without touching anyone who already paid for it.',
      409
    );
  }

  await course.destroy();
  return { message: 'Deleted successfully' };
};
