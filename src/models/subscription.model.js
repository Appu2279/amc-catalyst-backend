import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
  },

  start_date: DataTypes.DATE,
  end_date: DataTypes.DATE,
}, {
  timestamps: true,
  underscored: true,
});

export default Subscription;