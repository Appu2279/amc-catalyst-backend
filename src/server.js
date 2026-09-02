import app from './app.js';
import { sequelize } from './models/index.js';
import { isStorageConfigured } from './config/storage.js';

const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// alter:true rewrites live tables to match the models on every boot, which can
// drop a column (and its data) the moment a model and the DB drift apart. Dev
// convenience only — production schema changes go through a migration.
const start = async () => {
  try {
    await sequelize.authenticate();

    // Surfaced at boot rather than discovered when a student opens a note and
    // gets a 503. Not fatal: everything except notes works without it.
    if (!isStorageConfigured) {
      console.warn(
        'WARNING: S3 storage is not configured — study notes cannot be uploaded or opened. ' +
          'Set AWS_REGION and S3_BUCKET (and, outside EC2, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).'
      );
    }

    if (isProduction) {
      console.log('DB connected (schema sync skipped in production)');
    } else {
      await sequelize.sync({ alter: true });
      console.log('DB connected and schema synced');
    }

    app.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

start();