// =======================
//  DEPENDENCIAS PRINCIPALES
// =======================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

// =======================
//  CONFIGURACIÓN ENV
// =======================
dotenv.config();

// =======================
//  IMPORTAR RUTAS Y MIDDLEWARES
// =======================
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const db = require('./config/database');

// =======================
//  CONFIGURACIÓN DEL SERVIDOR
// =======================
const app = express();

// =======================
//  MIDDLEWARES DE SEGURIDAD Y CONFIGURACIÓN
// =======================

// Cabeceras HTTP seguras
app.use(helmet());

// ✅ Configuración de CORS — permite acceso desde Angular local y tu IP pública de AWS
app.use(cors({
  origin: [
    'http://localhost:4200',            // Angular local
    'http://3.140.201.220:4200',        // IP pública AWS (frontend)
    /^http:\/\/3\.140\.201\.220(:\d+)?$/ // Regex para permitir cualquier puerto de esa IP
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Compresión HTTP
app.use(compression());

// Parseo de JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Manejo de cookies y logs
app.use(cookieParser());
app.use(morgan('dev'));

// =======================
//  HEALTH CHECK
// =======================
app.get('/health', async (req, res) => {
  try {
    // Verificar conexión a la base de datos
    await db.query('SELECT 1');

    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      database: 'Connected',
      port: process.env.PORT || 3000,
      message: '✅ Servidor funcionando correctamente'
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: 'Disconnected',
      message: '❌ Error en el servidor',
      error: error.message
    });
  }
});

// =======================
//  RUTAS PRINCIPALES
// =======================
app.use('/api', routes);

// =======================
//  RUTA PRINCIPAL DE PRUEBA
// =======================
app.get('/', (req, res) => {
  res.json({
    mensaje: '🚀 API RedStudent funcionando correctamente',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      usuarios: '/api/usuarios',
      publicaciones: '/api/publicaciones'
    }
  });
});

// =======================
//  MANEJO DE ERRORES
// =======================
app.use(errorHandler);

// =======================
//  RUTA NO ENCONTRADA (404)
// =======================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    mensaje: 'Ruta no encontrada'
  });
});

// =======================
//  INICIAR SERVIDOR
// =======================
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log('===============================');
  console.log(`✅ Servidor corriendo en puerto: ${PORT}`);
  console.log(`🌍 Host: ${HOST}`);
  console.log(`📦 Entorno: ${process.env.NODE_ENV || 'desarrollo'}`);
  console.log(`🩺 Health Check: http://localhost:${PORT}/health`);
  console.log(`🚀 API disponible en: http://localhost:${PORT}/api`);
  console.log('===============================');
});

module.exports = app;
