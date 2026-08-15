import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Course = sequelize.define('Course', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  description: DataTypes.TEXT,

  duration_months: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },

  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },

  // Marketing label on the pricing card, e.g. 'MOST POPULAR'. Null = no badge.
  badge: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  // Left-to-right order of the pricing cards. Price order is not the display
  // order — the cheapest standalone plan sits last on the client's layout.
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },

  // Tiered plans show "Everything in <parent> PLUS …" instead of repeating the
  // whole feature list. Null for plans that stand on their own.
  inherits_from_course_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  timestamps: true,
  underscored: true,
});

export default Course;