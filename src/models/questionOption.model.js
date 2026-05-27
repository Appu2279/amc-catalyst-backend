// =============================================
// models/question-option.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const QuestionOption = sequelize.define(
  'QuestionOption',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    question_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    option_key: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    option_text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    option_image: {
      type: DataTypes.STRING,
    },

    is_correct: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    explanation: {
      type: DataTypes.TEXT,
    },
  },
  {
    tableName: 'question_options',
    underscored: true,
  }
);

export default QuestionOption;