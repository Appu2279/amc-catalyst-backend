// =============================================
// models/note.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Note = sequelize.define(
  'Note',
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

    description: {
      type: DataTypes.TEXT,
    },

    // Cloudinary public_id, e.g. 'amc-catalyst/notes/cardiology-basics'. This,
    // not the URL, is what the backend signs at request time — see
    // config/cloudinary.js. Unique so re-running the upload script updates the
    // existing row rather than creating a duplicate note.
    storage_public_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    // The unsigned secure_url. Kept for admin/debugging only: it 401s without a
    // signature, and it is never included in an API response.
    file_url: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    file_size_bytes: {
      type: DataTypes.INTEGER,
    },

    page_count: {
      type: DataTypes.INTEGER,
    },

    // Manual ordering on the Notes page. Ties break by title.
    sort_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    // Every note is free today; access is gated on being logged in. This exists
    // so that gating notes behind a subscription later is a change to
    // note.service.js alone, with no migration against live data.
    is_free: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
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
    tableName: 'notes',
    underscored: true,
  }
);

export default Note;
