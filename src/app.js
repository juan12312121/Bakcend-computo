const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const db = require('./config/database');
const { s3 } = require('./config/aws');
const { genAI } = require('./config/gemini');

// 🆕 Importar SSE y modelo de Notificaciones
const { enviarEventoSSE } = require('./routes/notificacionesRoutes');
const Notificacion = require('./models/Notificacion');

const app = express();

// Crear carpetas locales (respaldo opcional)
const uploadsDir = path.join(__dirname, 'uploads');
const perfilesDir = path.join(uploadsDir, 'perfiles');
const portadasDir = path.join(uploadsDir, 'portadas');
const publicacionesDir = path.join(uploadsDir, 'publicaciones');

[uploadsDir, perfilesDir, portadasDir, publicacionesDir].forEach(dir => {
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
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false // Deshabilitar temporalmente para depuración si es necesario
}));

app.use(cors({
  origin: (origin, callback) => {
    callback(null, true); // acepta cualquier origen
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'X-Requested-With',
    'Accept'
  ],
  exposedHeaders: [
    'Content-Type',
    'Cache-Control'
  ]
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

// 🆕 Servir carpeta uploads con CORS y caché control
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// 🆕 CONFIGURAR SSE EN EL MODELO ANTES DE REGISTRAR RUTAS
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

// 🔥 Endpoint para verificar S3
app.get('/api/s3/health', async (req, res) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME
    };
    
    await s3.headBucket(params).promise();
    
    res.json({
      success: true,
      mensaje: '✅ Conexión con S3 exitosa',
      bucket: process.env.AWS_BUCKET_NAME,
      region: process.env.AWS_REGION,
      url: process.env.AWS_S3_URL
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      mensaje: '❌ Error al conectar con S3',
      error: error.message,
      bucket: process.env.AWS_BUCKET_NAME
    });
  }
});

// 🤖 Endpoint para verificar GEMINI
app.get('/api/gemini/health', async (req, res) => {
  try {
    console.log('🤖 Verificando conexión con Gemini...');
    
    // Obtener modelo
    const modelo = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // Hacer una solicitud de prueba simple
    const resultado = await modelo.generateContent({
      contents: [{ 
        role: 'user', 
        parts: [{ text: 'Responde solo con "OK"' }] 
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 10
      }
    });
    
    const respuesta = resultado.response.text();
    
    res.json({
      success: true,
      mensaje: '✅ Conexión con Gemini exitosa',
      modelo: 'gemini-1.5-flash',
      respuesta: respuesta.trim(),
      timestamp: new Date().toISOString(),
      apiKey: process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'
    });
    
  } catch (error) {
    console.error('❌ Error en Gemini health check:', error.message);
    res.status(500).json({
      success: false,
      mensaje: '❌ Error al conectar con Gemini',
      error: error.message,
      detalles: {
        modelo: 'gemini-1.5-flash',
        apiKey: process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// 🔥 Listar archivos en S3
app.get('/api/s3/files', async (req, res) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME
    };
    
    const data = await s3.listObjectsV2(params).promise();
    
    const archivos = data.Contents.map(file => ({
      nombre: file.Key,
      tamaño: file.Size,
      fecha: file.LastModified,
      url: `${process.env.AWS_S3_URL}/${file.Key}`
    }));
    
    res.json({
      success: true,
      total: archivos.length,
      archivos: archivos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug de archivos locales
app.get('/debug/uploads', (req, res) => {
  try {
    const uploadsExists = fs.existsSync(uploadsDir);
    const perfilesExists = fs.existsSync(perfilesDir);
    
    let archivosPerfiles = [];
    let archivosPublicaciones = [];
    let archivosPortadas = []; // Nuevo array para portadas
    
    if (perfilesExists) {
      archivosPerfiles = fs.readdirSync(perfilesDir).map(file => ({
        nombre: file,
        ruta: `/uploads/perfiles/${file}`,
        tamaño: fs.statSync(path.join(perfilesDir, file)).size
      }));
    }

    if (fs.existsSync(portadasDir)) { // Verificar y listar archivos en portadasDir
      archivosPortadas = fs.readdirSync(portadasDir).map(file => ({
        nombre: file,
        ruta: `/uploads/portadas/${file}`,
        tamaño: fs.statSync(path.join(portadasDir, file)).size
      }));
    }
    
    if (fs.existsSync(publicacionesDir)) {
      archivosPublicaciones = fs.readdirSync(publicacionesDir).map(file => ({
        nombre: file,
        ruta: `/uploads/publicaciones/${file}`,
        tamaño: fs.statSync(path.join(publicacionesDir, file)).size
      }));
    }
    
    res.json({
      success: true,
      nota: '⚠️ Archivos locales. S3 es el almacenamiento principal.',
      directorios: {
        perfiles: {
          existe: perfilesExists,
          cantidad: archivosPerfiles.length
        },
        publicaciones: {
          existe: fs.existsSync(publicacionesDir),
          cantidad: archivosPublicaciones.length
        }
      },
      archivos: {
        perfiles: archivosPerfiles,
        publicaciones: archivosPublicaciones
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔥 Health check general
app.get('/health', async (req, res) => {
  try {
    // Verificar BD
    const dbCheck = await db.execute('SELECT 1');
    
    res.json({
      success: true,
      mensaje: 'API RedStudent - Todo funcionando ✅',
      timestamp: new Date().toISOString(),
      servicios: {
        base_de_datos: '✅ Conectado',
        s3: '✅ Configurado',
        gemini: '✅ Configurado',
        sse: '✅ Configurado', // 🆕
        cors: '✅ Habilitado'
      },
      endpoints_debug: {
        s3_health: '/api/s3/health',
        gemini_health: '/api/gemini/health',
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
    mensaje: 'API RedStudent funcionando correctamente',
    version: '2.0.0 - AWS S3 + Gemini + SSE',
    almacenamiento: 'AWS S3',
    censura: 'Google Gemini',
    notificaciones: 'Server-Sent Events (SSE)', // 🆕
    endpoints: {
      health: '/health',
      s3Health: '/api/s3/health',
      geminiHealth: '/api/gemini/health',
      s3Files: '/api/s3/files',
      auth: '/api/auth',
      usuarios: '/api/usuarios',
      publicaciones: '/api/publicaciones',
      notificaciones: '/api/notificaciones',
      notificacionesSSE: '/api/notificaciones/stream/:usuarioId' // 🆕
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

// 🔥 NO usar app.listen() aquí - se hace en server.js
module.exports = app;