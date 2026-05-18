// =============================================
// models/mock-test.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const MockTest = sequelize.define(
  'MockTest',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    description: {
      type: DataTypes.TEXT,
    },

    duration_minutes: {
      type: DataTypes.INTEGER,
      defaultValue: 60,
    },

    total_questions: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_marks: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },

    test_type: {
      type: DataTypes.ENUM('fixed', 'dynamic'),
      defaultValue: 'fixed',
    },

    randomize_questions: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    randomize_options: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    configuration_json: {
      type: DataTypes.JSONB,
    },

    is_published: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    starts_at: {
      type: DataTypes.DATE,
    },

    ends_at: {
      type: DataTypes.DATE,
    },
  },
  {
    tableName: 'mock_tests',
    underscored: true,
  }
);

export default MockTest;