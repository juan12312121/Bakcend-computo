const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const db = require('./config/database');

const app = express();

const uploadsDir = path.join(__dirname, 'uploads');
const perfilesDir = path.join(uploadsDir, 'perfiles');
const publicacionesDir = path.join(uploadsDir, 'publicaciones');

[uploadsDir, perfilesDir, publicacionesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Carpeta creada: ${dir}`);
  } else {
    console.log(`✅ Carpeta existe: ${dir}`);
  }
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: [
    'http://localhost:4200',
    'http://13.59.190.199:4200',
    'http://3.144.201.57:4200',
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

console.log('📂 Sirviendo archivos desde:', path.join(__dirname, 'uploads'));

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filepath) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache por 1 día
    console.log('📤 Sirviendo archivo:', filepath);
  }
}));

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
        urlCompleta: `http://${req.get('host')}/uploads/perfiles/${file}`,
        tamaño: fs.statSync(path.join(perfilesDir, file)).size,
        fecha: fs.statSync(path.join(perfilesDir, file)).mtime
      }));
    }
    
    if (fs.existsSync(publicacionesDir)) {
      archivosPublicaciones = fs.readdirSync(publicacionesDir).map(file => ({
        nombre: file,
        ruta: `/uploads/publicaciones/${file}`,
        urlCompleta: `http://${req.get('host')}/uploads/publicaciones/${file}`,
        tamaño: fs.statSync(path.join(publicacionesDir, file)).size,
        fecha: fs.statSync(path.join(publicacionesDir, file)).mtime
      }));
    }
    
    res.json({
      success: true,
      directorios: {
        uploadsDir: {
          existe: uploadsExists,
          ruta: uploadsDir
        },
        perfilesDir: {
          existe: perfilesExists,
          ruta: perfilesDir,
          cantidadArchivos: archivosPerfiles.length
        },
        publicacionesDir: {
          existe: fs.existsSync(publicacionesDir),
          ruta: publicacionesDir,
          cantidadArchivos: archivosPublicaciones.length
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
      error: error.message,
      stack: error.stack
    });
  }
});



// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    mensaje: 'API RedStudent funcionando correctamente',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      usuarios: '/api/usuarios',
      publicaciones: '/api/publicaciones',
      uploads: '/uploads'
    }
  });
});

app.use('/api', routes);

app.use(errorHandler);

app.use((req, res) => {
  // Si la ruta empieza con /uploads, ya fue manejada arriba
  if (req.path.startsWith('/uploads')) {
    console.log('❌ Archivo no encontrado:', req.path);
  }
  res.status(404).json({
    success: false,
    mensaje: 'Ruta no encontrada',
    path: req.path
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log('🚀 Servidor corriendo en puerto:', PORT);
  console.log('🌐 Host:', HOST);
  console.log('📁 Uploads directory:', uploadsDir);
  console.log('🔧 Entorno:', process.env.NODE_ENV || 'desarrollo');
});

module.exports = app;