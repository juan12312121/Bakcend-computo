const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'redstudent_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Verificar conexión
pool.getConnection()
  .then(connection => {
    console.log('Conexión a MySQL exitosa');
    connection.release();
  })
  .catch(err => {
    console.error('Error al conectar a MySQL:', err.message);
  });

module.exports = pool;