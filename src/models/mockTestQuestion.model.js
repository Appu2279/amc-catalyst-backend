// =============================================
// models/mock-test-question.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const MockTestQuestion = sequelize.define(
  'MockTestQuestion',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    mock_test_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    question_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    question_order: {
      type: DataTypes.INTEGER,
    },
  },
  {
    tableName: 'mock_test_questions',
    underscored: true,
  }
);

export default MockTestQuestion;