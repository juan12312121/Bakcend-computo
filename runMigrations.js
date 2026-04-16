const fs = require('fs');
const path = require('path');
const db = require('./src/config/database');

async function runMigrations() {
    console.log('🔄 Iniciando migraciones de base de datos...');
    
    // Lista de archivos SQL a ejecutar en orden
    const migrationFiles = [
        'migrations_groups.sql',
        'migrations_invitations.sql',
        'migrations_chat_files.sql'
    ];

    for (const file of migrationFiles) {
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
            console.log(`\n📄 Ejecutando migración: ${file}`);
            try {
                const sql = fs.readFileSync(filePath, 'utf8');
                
                // Dividir el SQL por punto y coma, filtrando líneas vacías
                const statements = sql
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0 && !s.startsWith('--'));

                for (const statement of statements) {
                    try {
                        await db.query(statement);
                    } catch (err) {
                        // Ignorar errores si la columna ya existe en ALTER TABLE
                        if (!err.message.includes('Duplicate column name') && 
                            !err.message.includes('Multiple primary key defined')) {
                            console.warn(`⚠️ Aviso en statement: ${err.message}`);
                        }
                    }
                }
                console.log(`✅ Migración ${file} completada.`);
            } catch (error) {
                console.error(`❌ Error al procesar ${file}:`, error.message);
            }
        } else {
            console.warn(`⚠️ Archivo no encontrado: ${file}`);
        }
    }
    console.log('\n✨ Proceso de migración finalizado.');
}

module.exports = runMigrations;
