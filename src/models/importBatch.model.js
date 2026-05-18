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
        'failed'
      ),
      defaultValue: 'processing',
    },

    import_logs: {
      type: DataTypes.JSONB,
    },
  },
  {
    tableName: 'import_batches',
    underscored: true,
  }
);

export default ImportBatch;