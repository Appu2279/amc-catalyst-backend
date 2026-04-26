import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const CoursePricing = sequelize.define('CoursePricing', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  actual_price: DataTypes.FLOAT,
  discounted_price: DataTypes.FLOAT,

  is_early_bird: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  }
}, {
  timestamps: true,
  underscored: true,
});

export default CoursePricing;