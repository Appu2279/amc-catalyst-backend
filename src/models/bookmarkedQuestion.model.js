// =============================================
// models/bookmarked-question.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const BookmarkedQuestion = sequelize.define(
  'BookmarkedQuestion',
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

    question_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'bookmarked_questions',
    underscored: true,
  }
);

export default BookmarkedQuestion;