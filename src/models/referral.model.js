import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { REFERRAL_STATUS } from '../constants/referral.js';

/**
 * One attribution: a new account that signed up carrying a referral code.
 *
 * Created at registration, always — even when the programme is switched off —
 * so the picture of who brought whom stays continuous across policy changes.
 * Whether anything is owed is decided later, at qualification, from the mode in
 * force then.
 *
 *   joined     — account created with the code
 *   qualified  — that account's first subscription payment was approved
 *   rewarded   — every reward raised against this referral has been settled
 *
 * A user is referred at most once: referred_user_id is unique, and the first
 * code they arrive with is the one that counts.
 */
const Referral = sequelize.define(
  'Referral',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    referral_code_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    referred_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // The literal string the user signed up with, kept even though
    // referral_code_id resolves to the same thing — a partner code can be
    // renamed, and this is what was actually typed.
    code_used: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM(...Object.values(REFERRAL_STATUS)),
      allowNull: false,
      defaultValue: REFERRAL_STATUS.JOINED,
    },

    qualified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // The approved payment that tipped this into 'qualified'.
    qualifying_payment_claim_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // The programme mode at the moment of qualification, for the audit trail —
    // "why did this one pay out both sides and that one nothing".
    mode_at_qualification: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
  },
  {
    tableName: 'referrals',
    underscored: true,
    timestamps: true,
    indexes: [
      { name: 'referrals_referred_user_unique', unique: true, fields: ['referred_user_id'] },
      { name: 'referrals_code', fields: ['referral_code_id'] },
      { name: 'referrals_status', fields: ['status'] },
    ],
  }
);

export default Referral;
