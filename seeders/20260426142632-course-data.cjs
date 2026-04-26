'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const now = new Date();

    const featureList = [
      '2500+ Structured MCQs',
      'Recall Questions (Last 1 Year)',
      'Subject-wise QBank',
      '6 Mini Mocks + 3 Full-Length Mock Exams',
      'Complete Notes (All 20 Notebooks)',
      'Integrated Notes + MCQ learning approach',
      'Extended access for multiple revision cycles',
      'Exam-focused, high-yield content'
    ];

    for (const name of featureList) {
      await queryInterface.sequelize.query(`
        INSERT INTO features (name)
        VALUES ('${name}')
        ON CONFLICT DO NOTHING;
      `);
    }

    const [features] = await queryInterface.sequelize.query(`SELECT * FROM features`);

    const getFeatureId = (name) => features.find(f => f.name === name)?.id;

    const coursesData = [
      {
        title: 'QBank + Recall Plan',
        description: 'Structured, practice-focused plan for building concepts and aligning with recent AMC trends.',
        duration: 5,
        price: 5499,
        features: [
          '2500+ Structured MCQs',
          'Recall Questions (Last 1 Year)',
          'Subject-wise QBank'
        ],
        benefits: ['Referral: +1 Month Free']
      },

      {
        title: 'QBank + Recall + Mock Plan',
        description: 'Complete practice and testing plan for exam readiness.',
        duration: 5,
        price: 7000,
        features: [
          '2500+ Structured MCQs',
          'Recall Questions (Last 1 Year)',
          'Subject-wise QBank',
          '6 Mini Mocks + 3 Full-Length Mock Exams'
        ],
        benefits: ['Referral: +1 Month Free']
      },

      {
        title: 'Complete Notes + QBank Program',
        description: 'Comprehensive system combining notes + QBank.',
        duration: 6,
        actual_price: 20000,
        discounted_price: 17499,
        is_early_bird: true,
        features: [
          'Complete Notes (All 20 Notebooks)',
          '2500+ Structured MCQs',
          'Subject-wise QBank',
          'Recall Questions (Last 1 Year)',
          'Integrated Notes + MCQ learning approach'
        ],
        benefits: [
          '+1 Month Free',
          'Referral: +1 Month Free'
        ]
      },

      {
        title: 'Extended Complete Program',
        description: 'Long-term structured pathway for deep preparation.',
        duration: 10,
        actual_price: 27000,
        discounted_price: 24000,
        is_early_bird: true,
        features: [
          'Complete Notes (All 20 Notebooks)',
          '2500+ Structured MCQs',
          'Subject-wise QBank',
          'Recall Questions (Last 1 Year)',
          'Integrated Notes + MCQ learning approach',
          'Extended access for multiple revision cycles'
        ],
        benefits: ['Referral: +1 Month Free']
      },

      {
        title: 'Complete Notes Program',
        description: 'High-yield structured notes for revision.',
        duration: 6,
        actual_price: 17999,
        discounted_price: 15000,
        is_early_bird: true,
        features: [
          'Complete Notes (All 20 Notebooks)',
          'Exam-focused, high-yield content'
        ],
        benefits: ['Referral: +1 Month Free']
      }
    ];

    // ========================
    // 3. INSERT COURSES
    // ========================
    for (const course of coursesData) {

      const [existing] = await queryInterface.sequelize.query(`
        SELECT id FROM courses WHERE title = '${course.title}' LIMIT 1;
      `);

      let courseId;

      if (existing.length > 0) {
        courseId = existing[0].id;
      } else {
        const [result] = await queryInterface.sequelize.query(`
          INSERT INTO courses (title, description, duration_months, created_at, updated_at)
          VALUES ('${course.title}', '${course.description}', ${course.duration}, NOW(), NOW())
          RETURNING id;
        `);

        courseId = result[0].id;
      }

      // ========================
      // 4. PRICING
      // ========================
      await queryInterface.sequelize.query(`
        INSERT INTO course_pricings (course_id, actual_price, discounted_price, is_early_bird, created_at, updated_at)
        VALUES (
          ${courseId},
          ${course.actual_price || course.price},
          ${course.discounted_price || course.price},
          ${course.is_early_bird || false},
          NOW(),
          NOW()
        )
        ON CONFLICT DO NOTHING;
      `);

      // ========================
      // 5. FEATURES MAPPING
      // ========================
      for (const fname of course.features) {
        const featureId = getFeatureId(fname);

        await queryInterface.sequelize.query(`
          INSERT INTO course_features (course_id, feature_id)
          VALUES (${courseId}, ${featureId})
          ON CONFLICT DO NOTHING;
        `);
      }

      // ========================
      // 6. BENEFITS
      // ========================
      for (const benefit of course.benefits) {
        await queryInterface.sequelize.query(`
          INSERT INTO benefits (course_id, title)
          VALUES (${courseId}, '${benefit}')
          ON CONFLICT DO NOTHING;
        `);
      }
    }

    console.log('✅ All courses seeded successfully');
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('courses', null, {});
    await queryInterface.bulkDelete('features', null, {});
    await queryInterface.bulkDelete('course_pricings', null, {});
    await queryInterface.bulkDelete('course_features', null, {});
    await queryInterface.bulkDelete('benefits', null, {});
  }
};
