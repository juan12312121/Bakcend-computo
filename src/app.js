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

// =======================
//  CONFIGURACIÓN DEL SERVIDOR
// =======================
const app = express();

// Seguridad con cabeceras HTTP
app.use(helmet());

// Configuración de CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true
}));

// Compresión de respuestas HTTP
app.use(compression());

// Permitir JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookies y logging
app.use(cookieParser());
app.use(morgan('dev'));

// =======================
//  RUTAS PRINCIPALES
// =======================
app.use('/api', routes);

// Ruta raíz de prueba
app.get('/', (req, res) => {
  res.json({
    mensaje: '🚀 API RedStudent funcionando correctamente',
    version: '1.0.0',
    endpoints: {
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

app.listen(PORT, () => {
  console.log('===============================');
  console.log(` Servidor corriendo en puerto: ${PORT}`);
  console.log(` Entorno: ${process.env.NODE_ENV || 'desarrollo'}`);
  console.log(` API disponible en: http://localhost:${PORT}/api`);
  console.log('===============================');
});

module.exports = app;
