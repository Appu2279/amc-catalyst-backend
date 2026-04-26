import app from './app.js';
import { sequelize } from './models/index.js';

const PORT = process.env.PORT || 5000;

sequelize.sync({ alter: true }).then(() => {
  console.log('DB connected');

  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
});