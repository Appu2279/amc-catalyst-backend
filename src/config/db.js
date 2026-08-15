import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// A single DATABASE_URL when there is one; otherwise the separate DB_*
// variables, so local development is unchanged.
const databaseUrl = process.env.DATABASE_URL;

// TLS is required by managed providers and unavailable on a plain Postgres
// container, which does not generate a certificate. Ours runs beside the API on
// the private compose network, so DB_SSL=false there; an unset value keeps TLS
// on, since that is the safer default for anything reached over a network.
const useSsl = process.env.DB_SSL !== 'false';

const sequelize = databaseUrl
  ? new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: useSsl
        ? {
            ssl: {
              require: true,
              // Managed providers terminate TLS with their own CA, which Node
              // does not ship in its trust store.
              rejectUnauthorized: false,
            },
          }
        : {},
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
