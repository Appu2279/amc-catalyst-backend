import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Benefit = sequelize.define('Benefit', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  title: DataTypes.STRING
}, {
  timestamps: false,
  underscored: true,
});

export default Benefit;