import sequelize from '../config/db.js';

const CourseFeature = sequelize.define('CourseFeature', {}, {
  timestamps: false,
  underscored: true,
});

export default CourseFeature;