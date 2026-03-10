// src/app.js

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const db = require('./config/database');
const { enviarEventoSSE } = require('./routes/notificacionesRoutes');
const Notificacion = require('./models/Notificacion');

const app = express();

// Crear carpetas locales
const uploadsDir = path.join(__dirname, 'uploads');
const perfilesDir = path.join(uploadsDir, 'perfiles');
const portadasDir = path.join(uploadsDir, 'portadas');
const publicacionesDir = path.join(uploadsDir, 'publicaciones');
const historiasDir = path.join(uploadsDir, 'historias'); // 🆕 Para historias

[uploadsDir, perfilesDir, portadasDir, publicacionesDir, historiasDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Carpeta local creada: ${dir}`);
  } else {
    console.log(`📁 Carpeta ya existe: ${dir}`);
  }
});

// Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// 🔥 CORS MEJORADO
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:4200',
  'http://localhost:8100',
  'http://localhost:8080',
  'http://localhost',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('⚠️ Origen rechazado:', origin);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(morgan('dev'));

// 🛡️ SEGURIDAD ADICIONAL
app.use(hpp());

// 🚦 RATE LIMITING (Relajado para desarrollo)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20000, // Prácticamente sin límite para dev
  message: { success: false, mensaje: 'Demasiadas peticiones, intenta más tarde' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// 🚦 RATE LIMITING AGRESIVO PARA AUTH (Relajado para desarrollo)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // Máximo 1000 intentos
  message: { success: false, mensaje: 'Demasiados intentos de acceso, intenta en 15 minutos' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/registro', authLimiter);

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configurar SSE
console.log('========================================');
console.log('🔌 Configurando SSE en el modelo de Notificaciones...');
console.log('========================================');

try {
  Notificacion.configurarSSE(enviarEventoSSE);
  console.log('✅ SSE configurado correctamente en el modelo de Notificaciones');
  console.log('📡 Función enviarEventoSSE:', typeof enviarEventoSSE);
} catch (error) {
  console.error('❌ Error al configurar SSE:', error);
}

console.log('========================================');

// Health check general
app.get('/debug/uploads', (req, res) => {
  try {
    const uploadsExists = fs.existsSync(uploadsDir);
    const perfilesExists = fs.existsSync(perfilesDir);

    let archivosPerfiles = [];
    let archivosPublicaciones = [];
    let archivosHistorias = [];

    if (perfilesExists) {
      archivosPerfiles = fs.readdirSync(perfilesDir).map(file => ({
        nombre: file,
        ruta: `/uploads/perfiles/${file}`,
        tamaño: fs.statSync(path.join(perfilesDir, file)).size
      }));
    }

    if (fs.existsSync(publicacionesDir)) {
      archivosPublicaciones = fs.readdirSync(publicacionesDir).map(file => ({
        nombre: file,
        ruta: `/uploads/publicaciones/${file}`,
        tamaño: fs.statSync(path.join(publicacionesDir, file)).size
      }));
    }

    if (fs.existsSync(historiasDir)) {
      archivosHistorias = fs.readdirSync(historiasDir).map(file => ({
        nombre: file,
        ruta: `/uploads/historias/${file}`,
        tamaño: fs.statSync(path.join(historiasDir, file)).size
      }));
    }

    res.json({
      success: true,
      directorios: {
        perfiles: {
          existe: perfilesExists,
          cantidad: archivosPerfiles.length
        },
        publicaciones: {
          existe: fs.existsSync(publicacionesDir),
          cantidad: archivosPublicaciones.length
        },
        historias: {
          existe: fs.existsSync(historiasDir),
          cantidad: archivosHistorias.length
        }
      },
      archivos: {
        perfiles: archivosPerfiles,
        publicaciones: archivosPublicaciones,
        historias: archivosHistorias
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check general
app.get('/health', async (req, res) => {
  try {
    const dbCheck = await db.execute('SELECT 1');

    res.json({
      success: true,
      mensaje: 'API TrinoFlow - Todo funcionando ✅',
      timestamp: new Date().toISOString(),
      servicios: {
        base_de_datos: '✅ Conectado',
        sse: '✅ Configurado',
        cors: '✅ Habilitado'
      },
      red: {
        ip_local: '192.168.100.70',
        puerto: process.env.PORT || 3000
      },
      endpoints_debug: {
        uploads: '/debug/uploads'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      mensaje: '❌ Error en health check',
      error: error.message
    });
  }
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API TrinoFlow funcionando correctamente 🚀',
    version: '3.0.0 - Local Storage + SSE',
    almacenamiento: 'Local',
    notificaciones: 'Server-Sent Events (SSE)',
    plataformas: ['Web'],
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      usuarios: '/api/usuarios',
      publicaciones: '/api/publicaciones',
      historias: '/api/historias',
      notificaciones: '/api/notificaciones',
      notificacionesSSE: '/api/notificaciones/stream/:usuarioId'
    }
  });
});

// Rutas principales
app.use('/api', routes);

// Manejador de errores
app.use(errorHandler);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    mensaje: 'Ruta no encontrada',
    path: req.path
  });
});

module.exports = app;