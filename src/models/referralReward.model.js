import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { REWARD_KIND, REWARD_STATUS } from '../constants/referral.js';

/**
 * Money owed because a referral qualified.
 *
 * Raised when the referred user's first payment is approved, one row per
 * beneficiary:
 *   • kind 'referrer' — always (unless the mode is 'off')
 *   • kind 'referee'  — additionally, when the mode is 'both'
 *
 * The amount is snapshotted from ReferralConfig at creation. Settlement is
 * manual and outside the app: an admin pays by whatever means and marks the row
 * paid. Nothing here moves money or touches a balance.
 */
const ReferralReward = sequelize.define(
  'ReferralReward',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    referral_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    kind: {
      type: DataTypes.ENUM(...Object.values(REWARD_KIND)),
      allowNull: false,
    },

    // The account owed the money. Null only for a 'referrer' reward whose code
    // is a partner code — then the payee is partner_name on the ReferralCode.
    beneficiary_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },

    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'INR',
    },

    status: {
      type: DataTypes.ENUM(...Object.values(REWARD_STATUS)),
      allowNull: false,
      defaultValue: REWARD_STATUS.PENDING,
    },

    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    paid_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // How it was settled — "UPI to 98xxxx", "adjusted on invoice #12".
    payout_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: 'referral_rewards',
    underscored: true,
    timestamps: true,
    indexes: [
      // One reward per beneficiary kind per referral — the qualification step
      // is written to be safe to retry.
      {
        name: 'referral_rewards_referral_kind_unique',
        unique: true,
        fields: ['referral_id', 'kind'],
      },
      { name: 'referral_rewards_status', fields: ['status'] },
      { name: 'referral_rewards_beneficiary', fields: ['beneficiary_user_id'] },
    ],
  }
);

export default ReferralReward;
