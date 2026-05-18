import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const AttemptQuestion = sequelize.define(
  'AttemptQuestion',
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

    question_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'attempt_questions',
    underscored: true,
    timestamps: false,
  }
);

export default AttemptQuestion;
