import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import {
  REFERRAL_MODE_VALUES,
  DEFAULT_REFERRAL_MODE,
  DEFAULT_REFERRAL_REWARD_AMOUNT,
  DEFAULT_REFERRAL_CURRENCY,
} from '../constants/referral.js';

/**
 * The live settings for the referral programme. Exactly one row (id = 1);
 * referral.service.js's getConfig() creates it on first read.
 *
 * A singleton table rather than a generic key/value store because there are
 * only these three knobs and they want real column types — an enum the database
 * validates and a DECIMAL, not a bag of stringified JSON.
 */
const ReferralConfig = sequelize.define(
  'ReferralConfig',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true },

    mode: {
      type: DataTypes.ENUM(...REFERRAL_MODE_VALUES),
      allowNull: false,
      defaultValue: DEFAULT_REFERRAL_MODE,
    },

    // What one qualified referral is worth to the referrer right now. Copied
    // onto the ReferralReward when it is earned, so lowering this later leaves
    // outstanding rewards untouched.
    reward_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: DEFAULT_REFERRAL_REWARD_AMOUNT,
    },

    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: DEFAULT_REFERRAL_CURRENCY,
    },
  },
  {
    tableName: 'referral_config',
    underscored: true,
    timestamps: true,
  }
);

export default ReferralConfig;
