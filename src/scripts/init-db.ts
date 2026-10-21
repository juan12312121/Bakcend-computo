/**
 * Prepara la base MySQL local.
 *   npm run db:init            → crea la base si no existe, carga el respaldo si está vacía y completa el esquema
 *   npm run db:init -- --force → borra la base y la vuelve a cargar desde cero
 */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';
import { sequelize } from '../infrastructure/database/models';
import { SchemaSync } from '../infrastructure/database/SchemaSync';

const RESPALDO = path.resolve(__dirname, '../../database/redstudent_db.sql');

async function prepararBase(force: boolean): Promise<boolean> {
  const conexion = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  try {
    if (force) await conexion.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
    await conexion.query(`CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conexion.query(`USE \`${env.DB_NAME}\``);

    const [tablas] = await conexion.query('SHOW TABLES');
    if ((tablas as unknown[]).length > 0) return false;

    console.log('📥 Cargando respaldo database/redstudent_db.sql ...');
    await conexion.query(fs.readFileSync(RESPALDO, 'utf8'));
    return true;
  } finally {
    await conexion.end();
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const cargado = await prepararBase(force);
  if (!cargado) console.log(`ℹ️  La base ${env.DB_NAME} ya tenía tablas: no se recargó el respaldo (usa --force para recargar).`);

  const cambios = await new SchemaSync(sequelize).ejecutar();
  cambios.forEach((c) => console.log(`  • ${c}`));
  console.log(cambios.length ? `✅ Esquema actualizado (${cambios.length} cambios)` : '✅ El esquema ya estaba al día');

  await sequelize.close();
}

main().catch((error: Error) => {
  console.error('❌ Error preparando la base:', error.message);
  process.exit(1);
});
