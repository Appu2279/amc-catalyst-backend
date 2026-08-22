// =============================================
// models/import-batch.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const ImportBatch = sequelize.define(
  'ImportBatch',
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

    questions_pdf: {
      type: DataTypes.STRING,
    },

    answers_pdf: {
      type: DataTypes.STRING,
    },

    total_questions: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    imported_questions: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    failed_questions: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM(
        'processing',
        'completed',
        'failed',
        'approved'
      ),
      defaultValue: 'processing',
    },

    import_logs: {
      type: DataTypes.JSONB,
    },

    /**
     * Whether students can see this batch's questions.
     *
     * An import batch doubles as the student-facing grouping for recalls — one
     * upload is one month's recall, and `title` is already written that way
     * ("August Recall 2026"). Hiding a batch takes its questions out of
     * practice everywhere without deleting anything, so it can be shown again
     * later.
     *
     * Distinct from `status`, which tracks whether the import itself worked.
     * A batch can be successfully imported (approved) and still be hidden.
     */
    is_visible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: 'import_batches',
    underscored: true,
  }
);

export default ImportBatch;