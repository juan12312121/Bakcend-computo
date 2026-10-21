// Crea la base local redstudent_db en el MySQL de esta PC y carga el respaldo + tablas extra.
// Uso: npm run db:init            (no toca nada si la base ya tiene tablas)
//      npm run db:init -- --force (borra y vuelve a cargar el respaldo)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const raiz = path.join(__dirname, '..');
const DB_NAME = process.env.DB_NAME || 'redstudent_db';
const force = process.argv.includes('--force');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  if (force) await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${DB_NAME}\``);

  const [tablas] = await conn.query('SHOW TABLES');
  if (tablas.length > 0 && !force) {
    console.log(`La base ${DB_NAME} ya tiene ${tablas.length} tablas; no se cargó el respaldo (usa --force para recargar).`);
  } else {
    console.log('Cargando redstudent_db.sql ...');
    await conn.query(fs.readFileSync(path.join(raiz, 'redstudent_db.sql'), 'utf8'));
    console.log('Creando tablas de chat ...');
    await conn.query(fs.readFileSync(path.join(raiz, 'src', 'config', 'chat_tables.sql'), 'utf8'));
  }
  await conn.end();

  // Grupos, invitaciones y adjuntos de chat (las mismas que corre el servidor al arrancar)
  const runMigrations = require('../runMigrations');
  await runMigrations();

  // Columnas de seguridad (rol, intentos, bloqueo) y tabla logs_seguridad
  require('child_process').execFileSync(process.execPath, [path.join(raiz, 'migrate_security.js')], {
    cwd: raiz,
    stdio: 'inherit',
  });

  console.log(`\nListo: base ${DB_NAME} preparada en ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error preparando la base:', err.message);
  process.exit(1);
});
