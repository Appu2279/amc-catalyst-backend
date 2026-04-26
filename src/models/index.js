import sequelize from '../config/db.js';

import User from './user.model.js';
import Course from './course.model.js';
import CoursePricing from './coursePricing.model.js';
import Feature from './feature.model.js';
import CourseFeature from './courseFeature.model.js';
import Benefit from './benefit.model.js';
import Subscription from './subscription.model.js';

// 🔗 Relationships

// Course ↔ Pricing
Course.hasMany(CoursePricing, { foreignKey: 'course_id' });
CoursePricing.belongsTo(Course);

// Course ↔ Feature
Course.belongsToMany(Feature, { through: CourseFeature });
Feature.belongsToMany(Course, { through: CourseFeature });

// Course ↔ Benefit
Course.hasMany(Benefit, { foreignKey: 'course_id' });
Benefit.belongsTo(Course);

// Subscription
User.hasMany(Subscription, { foreignKey: 'user_id' });
Subscription.belongsTo(User);

Course.hasMany(Subscription, { foreignKey: 'course_id' });
Subscription.belongsTo(Course);

// ✅ Export properly
export {
  sequelize,
  User,
  Course,
  CoursePricing,
  Feature,
  CourseFeature,
  Benefit,
  Subscription
};