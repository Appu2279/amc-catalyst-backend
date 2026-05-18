// =============================================
// models/user-answer.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const UserAnswer = sequelize.define(
  'UserAnswer',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    attempt_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    question_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    selected_option_id: {
      type: DataTypes.INTEGER,
    },

    is_correct: {
      type: DataTypes.BOOLEAN,
    },

    answered_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'user_answers',
    underscored: true,
  }
);

export default UserAnswer;