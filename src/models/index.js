import sequelize from '../config/db.js';
import User from './user.model.js';
import Plan from './plan.model.js';
import Subscription from './subscription.model.js';

// Relations
User.hasOne(Subscription, { foreignKey: 'user_id' });
Subscription.belongsTo(User);

Plan.hasMany(Subscription, { foreignKey: 'plan_id' });
Subscription.belongsTo(Plan);

export {
  sequelize,
  User,
  Plan,
  Subscription
};