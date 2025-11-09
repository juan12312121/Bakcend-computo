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
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: [
    'http://localhost:4200',
    'http://13.59.190.199:4200',
    'http://3.146.83.30:4200',
    /^http:\/\/3\.144\.201\.57(:\d+)?$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

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

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API RedStudent funcionando correctamente',
    version: '2.0.0 - AWS S3',
    almacenamiento: 'AWS S3',
    endpoints: {
      health: '/health',
      s3Health: '/api/s3/health',
      s3Files: '/api/s3/files',
      auth: '/api/auth',
      usuarios: '/api/usuarios',
      publicaciones: '/api/publicaciones'
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