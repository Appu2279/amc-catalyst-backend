import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { DEFAULT_AUD_TO_INR_RATE } from '../constants/pricing.js';

/**
 * The live AUD→INR conversion rate. Exactly one row (id = 1);
 * pricingConfig.service.js's getConfig() creates it on first read.
 *
 * A singleton table, matching ReferralConfig — one knob, so no need for a
 * generic key/value store.
 */
const PricingConfig = sequelize.define(
  'PricingConfig',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true },

    aud_to_inr_rate: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false,
      defaultValue: DEFAULT_AUD_TO_INR_RATE,
    },
  },
  {
    tableName: 'pricing_config',
    underscored: true,
    timestamps: true,
  }
);

export default PricingConfig;
