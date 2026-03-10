const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ Usar rutas ABSOLUTAS basadas en la ubicación del proyecto
const uploadsBase = path.join(__dirname, '../uploads');

// ✅ Crear carpetas si no existen
const crearCarpetas = () => {
  const carpetas = [
    path.join(uploadsBase, 'perfiles'),
    path.join(uploadsBase, 'portadas'),
    path.join(uploadsBase, 'publicaciones'),
    path.join(uploadsBase, 'historias'),
    path.join(uploadsBase, 'documentos') // 🆕 Para documentos adjuntos
  ];

  carpetas.forEach(carpeta => {
    if (!fs.existsSync(carpeta)) {
      fs.mkdirSync(carpeta, { recursive: true });
      console.log(`✅ Carpeta creada: ${carpeta}`);
    } else {
      console.log(`📁 Carpeta ya existe: ${carpeta}`);
    }
  });
};

// Ejecutar creación de carpetas al iniciar
crearCarpetas();

// ============================================
// CONFIGURACIÓN DE ALMACENAMIENTO
// ============================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let destino;
    
    // Determinar carpeta según el tipo de archivo
    if (file.fieldname === 'foto_perfil') {
      destino = path.join(uploadsBase, 'perfiles');
    } else if (file.fieldname === 'foto_portada') {
      destino = path.join(uploadsBase, 'portadas');
    } else if (file.fieldname === 'imagen') {
      destino = path.join(uploadsBase, 'publicaciones');
    } else if (file.fieldname === 'historia') {
      destino = path.join(uploadsBase, 'historias');
    } else if (file.fieldname === 'documento' || file.fieldname === 'documentos') {
      destino = path.join(uploadsBase, 'documentos');
    } else {
      destino = path.join(uploadsBase, 'publicaciones'); // Default
    }
    
    console.log(`📤 Guardando ${file.fieldname} en: ${destino}`);
    cb(null, destino);
  },
  filename: function (req, file, cb) {
    // 🔥 Obtener usuario_id desde req.usuario (viene del middleware proteger)
    const usuario_id = req.usuario ? req.usuario.id : 'guest';
    
    // Generar nombre único con timestamp
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const randomSuffix = Math.floor(Math.random() * 10000);
    
    // Formato: {fieldname}-{usuario_id}-{timestamp}-{random}.ext
    const filename = `${file.fieldname}-${usuario_id}-${timestamp}-${randomSuffix}${ext}`;
    
    console.log(`📝 Archivo generado: ${filename} para usuario ${usuario_id}`);
    
    cb(null, filename);
  }
});

// ============================================
// FILTROS DE ARCHIVOS
// ============================================

// Filtro para imágenes
const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    console.log(`✅ Imagen válida: ${file.originalname}`);
    return cb(null, true);
  } else {
    console.log(`❌ Imagen rechazada: ${file.originalname}`);
    cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif, webp)'));
  }
};

// Filtro para documentos (PDF, Word, Excel, etc.)
const documentFilter = (req, file, cb) => {
  const allowedTypes = /pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|csv/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  
  // MIMEtypes comunes para documentos
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-rar-compressed',
    'application/x-zip-compressed'
  ];
  
  const mimetype = allowedMimeTypes.includes(file.mimetype);

  if (mimetype && extname) {
    console.log(`✅ Documento válido: ${file.originalname}`);
    return cb(null, true);
  } else {
    console.log(`❌ Documento rechazado: ${file.originalname} (${file.mimetype})`);
    cb(new Error('Tipo de documento no permitido. Usa: PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP, RAR'));
  }
};

// Filtro mixto (imágenes + documentos)
const mixedFilter = (req, file, cb) => {
  // Si el campo es "imagen" o campos relacionados con imágenes, usar filtro de imagen
  if (['imagen', 'foto_perfil', 'foto_portada', 'historia'].includes(file.fieldname)) {
    return imageFilter(req, file, cb);
  }
  
  // Si el campo es "documentos" o "documento", usar filtro de documentos
  if (['documentos', 'documento'].includes(file.fieldname)) {
    return documentFilter(req, file, cb);
  }
  
  // Default: rechazar
  cb(new Error(`Campo de archivo no reconocido: ${file.fieldname}`));
};

// ============================================
// INSTANCIAS DE MULTER
// ============================================

// Upload básico (solo imágenes)
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB máximo
  },
  fileFilter: imageFilter
});

// Upload para publicaciones (imagen + documentos)
const uploadPublicacion = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB para documentos
    files: 6 // 1 imagen + 5 documentos
  },
  fileFilter: mixedFilter
});

// Upload solo para documentos
const uploadDocumentos = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5
  },
  fileFilter: documentFilter
});

// ============================================
// EXPORTAR
// ============================================
module.exports = {
  upload,
  uploadPublicacion,
  uploadDocumentos, // 🆕 Exportar uploadDocumentos
  crearCarpetas
};