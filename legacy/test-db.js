const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

async function testConnection() {
    console.log('--- TEST DE CONEXIÓN A BASE DE DATOS ---');

    const envPath = path.join(__dirname, '.env');
    console.log('Cargando .env desde:', envPath);
    dotenv.config({ path: envPath });

    console.log('Configuración:');
    console.log('Host:', process.env.DB_HOST);
    console.log('User:', process.env.DB_USER);
    console.log('DB:', process.env.DB_NAME);
    console.log('Port:', process.env.DB_PORT);

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'redstudent_db',
            port: process.env.DB_PORT || 3306
        });

        console.log('✅ CONEXIÓN EXITOSA A MYSQL');
        const [rows] = await connection.execute('SELECT 1 + 1 AS result');
        console.log('Prueba de query simple:', rows[0].result === 2 ? 'OK' : 'FALLO');

        await connection.end();
        console.log('Conexión cerrada.');
    } catch (error) {
        console.error('❌ ERROR AL CONECTAR:');
        console.error(error);
        process.exit(1);
    }
}

testConnection();
