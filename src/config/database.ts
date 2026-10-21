import { Sequelize } from 'sequelize';
import { env, type Env } from './env';

/** Opciones TLS para mysql2 (Sequelize y el script init-db), o undefined si DB_SSL=false. */
export function opcionesSsl(config: Pick<Env, 'DB_SSL' | 'DB_SSL_CA'> = env): { ca?: string; rejectUnauthorized: boolean } | undefined {
  if (!config.DB_SSL) return undefined;
  const ca = config.DB_SSL_CA?.replace(/\\n/g, '\n').trim();
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

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
        dialectOptions: opcionesSsl() ? { ssl: opcionesSsl() } : {},
        define: {
          charset: 'utf8mb4',
          collate: 'utf8mb4_unicode_ci',
        },
        pool: { max: 10, min: 0, idle: 10_000 },
      });
