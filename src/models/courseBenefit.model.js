import sequelize from '../config/db.js';

const CourseBenefit = sequelize.define('CourseBenefit', {}, {
  timestamps: false,
  underscored: true,
});

export default CourseBenefit;
