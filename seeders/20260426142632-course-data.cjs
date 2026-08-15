'use strict';

/**
 * Pricing plans, as supplied by the client.
 *
 * Only the plan tables are touched (courses, course_pricings, features,
 * course_features, benefits, course_benefits). Questions, users, subjects and
 * attempts are left alone — this seeder is safe to re-run against a live DB.
 *
 * Everything outside the four cards on the client's sheet (the highlight strip,
 * international pricing, additional-access note, early-bird footer) is static
 * copy on the Pricing page, not stored here.
 */

const PLANS = [
  {
    title: 'Notes Only',
    description: 'Complete AMC Catalyst notes with recalls, MCQs and mock exams.',
    duration_months: 6,
    badge: null,
    sort_order: 1,
    actual_price: 24999,
    discounted_price: 21999,
    features: [
      'Complete AMC Catalyst Notes (All Subjects)',
      'High-yield One-liners',
      'Image-based Learning',
      '10 Months of Recalls',
      'Monthly Recall Updates + Next 5 Months Updates',
      '2500+ Structured MCQs',
      'Subject-wise QBank',
      '3–5 Mock Exams',
      'Telegram Community',
      'Question Discussion',
      'Weekly Discussion Sessions (from October)',
    ],
  },
  {
    title: 'Standard',
    description: 'Everything in Notes Only, plus eMedici access.',
    duration_months: 6,
    badge: 'MOST POPULAR',
    sort_order: 2,
    inherits_from: 'Notes Only',
    actual_price: 27499,
    discounted_price: 24999,
    features: [
      { name: '2 Months eMedici Access', highlight: true },
    ],
  },
  {
    title: 'Premium',
    description: 'Everything in Standard, with extended eMedici access.',
    duration_months: 6,
    badge: 'BEST VALUE',
    sort_order: 3,
    inherits_from: 'Standard',
    actual_price: 29999,
    discounted_price: 27499,
    features: [
      { name: '5 Months eMedici Access', highlight: true },
    ],
  },
  {
    title: 'Recall + MCQ + Mock',
    description: 'Practice-only plan built around recalls, MCQs and mock exams.',
    duration_months: 6,
    badge: 'STANDALONE PLAN',
    sort_order: 4,
    actual_price: 5499,
    discounted_price: 4999,
    features: [
      '10 Months of Recalls',
      'Monthly Recall Updates + Next 5 Months Updates',
      '2500+ Structured MCQs',
      'Subject-wise QBank',
      '50 High-yield MCQs',
      '3–5 Mock Exams',
      'Major Question Bank Focused',
      'High-yield Exam-oriented Practice',
    ],
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    const now = new Date();

    await sql.transaction(async (transaction) => {
      const q = (text, replacements) =>
        sql.query(text, { replacements, transaction });

      // Clear the plan tables only. Join tables first so no FK is left dangling.
      await q('DELETE FROM course_features;');
      await q('DELETE FROM course_benefits;');
      await q('DELETE FROM course_pricings;');
      await q('DELETE FROM benefits;');
      await q('DELETE FROM features;');
      await q('DELETE FROM courses;');

      // Unique feature names across all plans, inserted once and shared.
      const featureNames = [
        ...new Set(
          PLANS.flatMap((p) => p.features.map((f) => (typeof f === 'string' ? f : f.name)))
        ),
      ];

      const featureIds = {};
      for (const name of featureNames) {
        const [rows] = await q(
          'INSERT INTO features (name) VALUES (:name) RETURNING id;',
          { name }
        );
        featureIds[name] = rows[0].id;
      }

      // Insert plans in sort order so a tier can reference the one above it.
      const courseIds = {};
      for (const plan of PLANS) {
        const [rows] = await q(
          `INSERT INTO courses
             (title, description, duration_months, is_active, badge, sort_order,
              inherits_from_course_id, created_at, updated_at)
           VALUES
             (:title, :description, :duration_months, true, :badge, :sort_order,
              :inherits_from_course_id, :now, :now)
           RETURNING id;`,
          {
            title: plan.title,
            description: plan.description,
            duration_months: plan.duration_months,
            badge: plan.badge,
            sort_order: plan.sort_order,
            inherits_from_course_id: plan.inherits_from
              ? courseIds[plan.inherits_from]
              : null,
            now,
          }
        );
        const courseId = rows[0].id;
        courseIds[plan.title] = courseId;

        await q(
          `INSERT INTO course_pricings
             (course_id, actual_price, discounted_price, is_early_bird, created_at, updated_at)
           VALUES (:course_id, :actual_price, :discounted_price, true, :now, :now);`,
          {
            course_id: courseId,
            actual_price: plan.actual_price,
            discounted_price: plan.discounted_price,
            now,
          }
        );

        for (const [index, feature] of plan.features.entries()) {
          const name = typeof feature === 'string' ? feature : feature.name;
          await q(
            `INSERT INTO course_features
               (course_id, feature_id, position, highlight)
             VALUES (:course_id, :feature_id, :position, :highlight);`,
            {
              course_id: courseId,
              feature_id: featureIds[name],
              position: index,
              highlight: typeof feature === 'string' ? false : !!feature.highlight,
            }
          );
        }
      }
    });

    console.log(`✅ Seeded ${PLANS.length} pricing plans`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query('DELETE FROM course_features;');
    await sql.query('DELETE FROM course_pricings;');
    await sql.query('DELETE FROM features;');
    await sql.query('DELETE FROM courses;');
  },
};
