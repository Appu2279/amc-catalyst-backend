// =============================================
// models/questionProgress.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One row per (user, question) the moment a student answers it in practice.
 *
 * This is what lets Recall resume where the student stopped, including after a
 * logout or on another device — the position lives on the server, not in the
 * browser. Storing the answered question rather than a "last position" index is
 * deliberate: question lists change as questions are added, deactivated or
 * filtered, and a stored index would silently point at the wrong question the
 * moment that happens. The resume point is derived instead — the first question
 * in the list the student has not answered yet.
 *
 * Separate from UserAnswer, which belongs to a timed mock attempt and is
 * scoped to that attempt. Practice has no attempt to hang off.
 */
const QuestionProgress = sequelize.define(
  'QuestionProgress',
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

    selected_option_id: {
      type: DataTypes.INTEGER,
    },

    is_correct: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    // Bumped every time the student answers this question again, so the most
    // recent attempt is what the UI reflects.
    answered_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'question_progress',
    underscored: true,
    indexes: [
      // One row per student per question: answering again updates the row
      // rather than appending, so "answered" stays a set and the counts cannot
      // drift above the number of questions.
      { unique: true, fields: ['user_id', 'question_id'] },
    ],
  }
);

export default QuestionProgress;
