import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * A shareable referral code.
 *
 * Two kinds live in one table so that attribution is a single lookup:
 *   • owner_type 'user'    — generated for every account at registration, e.g.
 *     "AISHA-7K2P". owner_user_id points at the account.
 *   • owner_type 'partner' — created by an admin for someone with no account (a
 *     collaborator, an influencer). The code string is whatever the partner
 *     asked for ("WINGX"); partner_name is how we recognise it in the list.
 *
 * A code is never deleted — a referral row points at it forever. Retiring one
 * is is_active = false, which stops new attributions without disturbing the
 * history.
 */
const ReferralCode = sequelize.define(
  'ReferralCode',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    // Stored uppercase, no whitespace — see normaliseCode in constants/referral.js.
    code: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },

    owner_type: {
      type: DataTypes.ENUM('user', 'partner'),
      allowNull: false,
    },

    // Set when owner_type = 'user'. No FK constraint: an account being removed
    // must not take its referral history with it.
    owner_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // Set when owner_type = 'partner'.
    partner_name: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },

    // Free text — who set this up, how to reach the partner, payout details.
    partner_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    // Admin who created a partner code. Null for the auto-generated user codes.
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: 'referral_codes',
    underscored: true,
    timestamps: true,
    indexes: [
      { name: 'referral_codes_code_unique', unique: true, fields: ['code'] },
      // One user, one code.
      {
        name: 'referral_codes_owner_user_unique',
        unique: true,
        fields: ['owner_user_id'],
        where: { owner_type: 'user' },
      },
    ],
  }
);

export default ReferralCode;
