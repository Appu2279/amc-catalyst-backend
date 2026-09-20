import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const CoursePricing = sequelize.define('CoursePricing', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  // Legacy fields — a price entered directly in INR, no AUD equivalent. Left
  // alone (not renamed/reinterpreted) so existing courses priced this way
  // before AUD pricing existed keep charging exactly what they always have.
  actual_price: DataTypes.FLOAT,
  discounted_price: DataTypes.FLOAT,

  // AUD fields — the currency courses are meant to be priced in going
  // forward. When set, these take priority: the INR amount shown and
  // actually charged is computed live as price × PricingConfig.aud_to_inr_rate
  // (see priceOf() in payment.service.js), not read from the fields above.
  actual_price_aud: DataTypes.FLOAT,
  discounted_price_aud: DataTypes.FLOAT,

  is_early_bird: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  }
}, {
  timestamps: true,
  underscored: true,
});

export default CoursePricing;