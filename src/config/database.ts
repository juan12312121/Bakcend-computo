import { Sequelize } from 'sequelize';
import { env } from './env';

/**
 * Única instancia de Sequelize para toda la API.
 * En pruebas se usa SQLite en memoria (DB_DIALECT=sqlite); en desarrollo, el MySQL local.
 */
export const sequelize =
  env.DB_DIALECT === 'sqlite'
    ? new Sequelize({ dialect: 'sqlite', storage: env.DB_STORAGE, logging: env.DB_LOGGING })
    : new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
        dialect: 'mysql',
        host: env.DB_HOST,
        port: env.DB_PORT,
        logging: env.DB_LOGGING ? console.log : false,
        timezone: '+00:00',
        define: {
          charset: 'utf8mb4',
          collate: 'utf8mb4_unicode_ci',
        },
        pool: { max: 10, min: 0, idle: 10_000 },
      });
