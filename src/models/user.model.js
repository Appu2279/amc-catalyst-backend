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
    unique: true,
    allowNull: false,
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
});

export default User;