require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./database');

async function initDb() {
    try {
        const sqlPath = path.join(__dirname, 'chat_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolon but ignore ones inside quotes if any (simple split here)
        const statements = sql.split(';').filter(s => s.trim().length > 0);

        for (const statement of statements) {
            await db.execute(statement);
            console.log('Executed statement successfully');
        }

        console.log('Chat tables initialized successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error initializing chat tables:', error);
        process.exit(1);
    }
}

initDb();
