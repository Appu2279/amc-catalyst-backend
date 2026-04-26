import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Feature = sequelize.define('Feature', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  name: {
    type: DataTypes.STRING,
    allowNull: false,
  }
}, {
  timestamps: false,
  underscored: true,
});

export default Feature;