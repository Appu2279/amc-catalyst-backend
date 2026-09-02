// =============================================
// models/subject.model.js
// =============================================
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Subject = sequelize.define(
  'Subject',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
      // Unique via the named index below — see the note on `indexes`.
    },

    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      // Unique via the named index below — see the note on `indexes`.
    },

    description: {
      type: DataTypes.TEXT,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: 'subjects',
    underscored: true,
    indexes: [
      // Unique constraints are declared here as NAMED indexes rather than with
      // `unique: true` on the attribute. Sequelize cannot match an anonymous
      // unique constraint to the one already in the database, so
      // sync({ alter: true }) adds a fresh one on every boot — Postgres names each
      // `<table>_<column>_key<N>`, and this database had built up 463 of them
      // across four tables before the declarations moved here. A named index is
      // matched by name and created once.
      { name: 'subjects_name_unique', unique: true, fields: ['name'] },
      { name: 'subjects_slug_unique', unique: true, fields: ['slug'] },
    ],
  }
);

export default Subject;