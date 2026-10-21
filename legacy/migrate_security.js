require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'redstudent_db',
        port: process.env.DB_PORT || 3306,
    });

    console.log('🚀 Iniciando migración de seguridad...');

    try {
        // 1. Añadir columnas a usuarios
        // Usamos consultas individuales para manejar errores si ya existen
        const columns = [
            "ALTER TABLE usuarios ADD COLUMN rol ENUM('usuario', 'admin') DEFAULT 'usuario' AFTER contrasena",
            "ALTER TABLE usuarios ADD COLUMN intentos_fallidos INT DEFAULT 0 AFTER carrera",
            "ALTER TABLE usuarios ADD COLUMN bloqueo_hasta TIMESTAMP NULL AFTER intentos_fallidos"
        ];

        for (const sql of columns) {
            try {
                await connection.execute(sql);
                console.log(`✅ Ejecutado: ${sql.substring(0, 50)}...`);
            } catch (err) {
                if (err.errno === 1060) {
                    console.log(`ℹ️ La columna ya existe, saltando...`);
                } else {
                    throw err;
                }
            }
        }

        // 2. Crear tabla de logs de seguridad
        console.log('Creating logs_seguridad table...');
        await connection.execute(`
      CREATE TABLE IF NOT EXISTS logs_seguridad (
        id INT NOT NULL AUTO_INCREMENT,
        usuario_id INT DEFAULT NULL,
        evento VARCHAR(100) NOT NULL,
        detalles TEXT,
        ip VARCHAR(45),
        user_agent TEXT,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_usuario (usuario_id),
        KEY idx_evento (evento)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        console.log('✅ Tabla logs_seguridad creada/verificada.');

        // 3. Asignar admin
        console.log('Assigning admin role to juabngonzalez4@gmail.com...');
        await connection.execute(`
      UPDATE usuarios SET rol = 'admin' WHERE email = 'juabngonzalez4@gmail.com';
    `);
        console.log('✅ Admin asignado.');

        console.log('🏁 Proceso finalizado.');
    } catch (error) {
        console.error('❌ Error crítico en la migración:', error);
    } finally {
        await connection.end();
    }
}

migrate();
