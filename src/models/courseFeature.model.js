import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const CourseFeature = sequelize.define('CourseFeature', {
  // Bullets are ordered per plan, so the same feature can sit in different
  // places on different cards.
  position: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },

  // Drawn as a callout box on the card instead of a plain tick — used for the
  // eMedici add-on on the Standard and Premium plans.
  highlight: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  timestamps: false,
  underscored: true,
});

export default CourseFeature;
