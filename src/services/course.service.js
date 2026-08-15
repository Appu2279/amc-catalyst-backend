import { sequelize, Course, CoursePricing, Feature, Benefit, Subscription } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

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

export const subscribeCourse = async (userId, courseId) => {
  const course = await Course.findByPk(courseId);
  if (!course) throw new AppError('Course not found', 404);

  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + course.duration_months);

  return Subscription.create({
    user_id: userId,
    course_id: courseId,
    start_date: new Date(),
    end_date: endDate,
    status: 'active',
  });
};

export const getMyCourses = (userId) =>
  Subscription.findAll({
    where: { user_id: userId },
    include: [{ model: Course, include: courseIncludes }],
  });

export const createCourse = async ({ title, description, duration_months, is_active, pricing, feature_ids, benefit_ids }) => {
  const t = await sequelize.transaction();
  try {
    const course = await Course.create({ title, description, duration_months, is_active }, { transaction: t });

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

export const updateCourse = async (id, { title, description, duration_months, is_active, pricing, feature_ids, benefit_ids }) => {
  const course = await Course.findByPk(id);
  if (!course) throw new AppError('Course not found', 404);

  const t = await sequelize.transaction();
  try {
    await course.update({ title, description, duration_months, is_active }, { transaction: t });

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

export const deleteCourse = async (id) => {
  const course = await Course.findByPk(id);
  if (!course) throw new AppError('Course not found', 404);
  await course.destroy();
  return { message: 'Deleted successfully' };
};
