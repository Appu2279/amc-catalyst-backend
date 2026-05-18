// =============================================
// models/user-mock-attempt.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const UserMockAttempt = sequelize.define(
  'UserMockAttempt',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    mock_test_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    score: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },

    total_correct: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_wrong: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    total_unanswered: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    started_at: {
      type: DataTypes.DATE,
    },

    completed_at: {
      type: DataTypes.DATE,
    },

    time_taken_seconds: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM(
        'in_progress',
        'completed',
        'abandoned'
      ),
      defaultValue: 'in_progress',
    },
  },
  {
    tableName: 'user_mock_attempts',
    underscored: true,
  }
);

export default UserMockAttempt;