import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Hosted Postgres (Supabase, Neon, Railway, Render) hands you a single
// DATABASE_URL and requires TLS. Local development keeps using the separate
// DB_* variables, so nothing changes on your machine.
const databaseUrl = process.env.DATABASE_URL;

const sequelize = databaseUrl
  ? new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: {
        ssl: {
          require: true,
          // Managed providers terminate TLS with their own CA, which Node does
          // not ship in its trust store.
          rejectUnauthorized: false,
        },
      },
      pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    })
  : new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASSWORD,
      {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: 'postgres',
        logging: false,
      }
    );

export default sequelize;
