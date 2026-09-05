import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import {
  PROFESSIONAL_ROLE_VALUES,
  COUNTRY_CODES,
  GRADUATION_YEAR_MIN,
  graduationYearMax,
} from '../constants/registration.js';

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  
  fullName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    // Unique via the named index below — see the note on `indexes`.
  },

  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  // Access level. Distinct from professionalRole below, which is what the
  // registrant does for a living.
  role: {
    type: DataTypes.ENUM('admin', 'user'),
    defaultValue: 'user',
  },

  // Profile details collected at registration. Nullable at the DB level because
  // accounts created before these fields existed have no value for them; the
  // register endpoint requires all three.
  professionalRole: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isIn: {
        args: [PROFESSIONAL_ROLE_VALUES],
        msg: 'Invalid professional role',
      },
    },
  },

  // ISO 3166-1 alpha-2 country code, e.g. 'AU'.
  country: {
    type: DataTypes.STRING(2),
    allowNull: true,
    validate: {
      isIn: {
        args: [COUNTRY_CODES],
        msg: 'Invalid country',
      },
    },
  },

  // Private S3 object key for the profile picture, e.g.
  // 'avatars/21-1788623746123'. Never handed to the browser as-is — the client
  // reads it back through GET /api/me/avatar, which streams the bytes with the
  // app's own credentials. Null means "no picture, fall back to initials".
  avatarUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  graduationYear: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      isInt: { msg: 'Year of graduation must be a whole number' },
      // Custom rather than min/max so the upper bound follows the clock instead
      // of freezing at whatever year the process started in.
      isWithinRange(value) {
        if (value === null || value === undefined) return;
        const max = graduationYearMax();
        if (value < GRADUATION_YEAR_MIN || value > max) {
          throw new Error(`Year of graduation must be between ${GRADUATION_YEAR_MIN} and ${max}`);
        }
      },
    },
  },
}, {
  timestamps: true,
  underscored: true,
  indexes: [
    // Unique constraints are declared here as NAMED indexes rather than with
    // `unique: true` on the attribute. Sequelize cannot match an anonymous
    // unique constraint to the one already in the database, so
    // sync({ alter: true }) adds a fresh one on every boot — Postgres names each
    // `<table>_<column>_key<N>`, and this database had built up 463 of them
    // across four tables before the declarations moved here. A named index is
    // matched by name and created once.
    { name: 'users_email_unique', unique: true, fields: ['email'] },
  ],
});

export default User;