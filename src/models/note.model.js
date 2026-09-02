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

    // S3 object key, e.g. 'amc-catalyst/notes/cardiology-basics.pdf'. This is
    // what the backend fetches at request time — see config/storage.js.
    // Unique so re-running the upload script updates the existing row instead
    // of creating a duplicate note.
    storage_public_id: {
      type: DataTypes.STRING,
      allowNull: false,
      // Unique via the named index below — see the note on `indexes`.
    },

    // Not a working URL — the bucket blocks public access, so this 403s if
    // opened directly. Kept only as a human-readable pointer for
    // admin/debugging; it is never included in an API response.
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

    /**
     * A free sample, readable by any signed-in user without a plan.
     *
     * Defaults to false now that notes are sold: a note uploaded and forgotten
     * about should be behind the paywall, not in front of it. Marking one free
     * is a deliberate act — they are the only thing a browsing student can use
     * to judge whether the notes are worth paying for.
     *
     * Existing rows keep whatever they were set to; only new notes get this
     * default. See scripts/migrate-subscription-entitlements.js, which moves the
     * column default in environments that never run sync().
     */
    is_free: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
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
    indexes: [
      // Unique constraints are declared here as NAMED indexes rather than with
      // `unique: true` on the attribute. Sequelize cannot match an anonymous
      // unique constraint to the one already in the database, so
      // sync({ alter: true }) adds a fresh one on every boot — Postgres names each
      // `<table>_<column>_key<N>`, and this database had built up 463 of them
      // across four tables before the declarations moved here. A named index is
      // matched by name and created once.
      { name: 'notes_storage_public_id_unique', unique: true, fields: ['storage_public_id'] },
    ],
  }
);

export default Note;
