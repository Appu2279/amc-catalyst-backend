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


    /**
     * A free sample, usable without a plan.
     *
     * Samples are the only way a student who has not paid can judge whether the
     * material is worth buying, so a handful of good ones earn their keep. They
     * are opt-in: anything not explicitly marked stays behind the paywall.
     */
    is_free: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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