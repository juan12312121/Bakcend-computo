module.exports = {
  // Servidor
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  
  // Base de datos
  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'redstudent_db',
    port: process.env.DB_PORT || 3306
  },
  
  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'tu_clave_secreta_aqui',
    expire: process.env.JWT_EXPIRE || '7d'
  },
  
  // Frontend
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200'
};
