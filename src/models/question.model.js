// =============================================
// models/question.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Question = sequelize.define(
  'Question',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    subject_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    topic_id: {
      type: DataTypes.INTEGER,
    },

    question_number: {
      type: DataTypes.INTEGER,
    },

    question_text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    explanation: {
      type: DataTypes.TEXT,
    },

    difficulty: {
      type: DataTypes.ENUM('easy', 'medium', 'hard'),
      defaultValue: 'medium',
    },

    question_type: {
      type: DataTypes.ENUM(
        'single_choice',
        'multiple_choice',
        'true_false',
        'image_based'
      ),
      defaultValue: 'single_choice',
    },

    source_type: {
      type: DataTypes.ENUM(
        'qbank',
        'recall',
        'mock',
        'previous_year'
      ),
      defaultValue: 'qbank',
    },

    source_year: {
      type: DataTypes.INTEGER,
    },

    question_image: {
      type: DataTypes.STRING,
    },

    question_images: {
      type: DataTypes.JSONB,
    },

    answer_images: {
      type: DataTypes.JSONB,
    },

    image_type: {
      type: DataTypes.STRING,
    },

    page_number: {
      type: DataTypes.INTEGER,
    },

    marks: {
      type: DataTypes.FLOAT,
      defaultValue: 1,
    },

    negative_marks: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },

    import_batch_id: {
      type: DataTypes.INTEGER,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

    created_by: {
      type: DataTypes.INTEGER,
    },
  },
  {
    tableName: 'questions',
    underscored: true,
  }
);

export default Question;