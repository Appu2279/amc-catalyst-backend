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

  /**
   * Which parts of the product this plan grants, as section keys — see
   * constants/sections.js. Sections inherited via inherits_from_course_id are
   * NOT repeated here; list only what this tier adds.
   *
   * This is the *current* definition of the plan and is safe to edit: it is
   * read when a subscription is granted and never again. Existing subscribers
   * keep the sections that were copied onto their Subscription at the time
   * they paid, so narrowing a plan does not narrow anyone's live access.
   */
  sections: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },
}, {
  timestamps: true,
  underscored: true,
});

export default Course;