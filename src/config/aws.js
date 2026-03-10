// src/config/aws.js
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const s3 = new AWS.S3({
  apiVersion: '2006-03-01',
  signatureVersion: 'v4'
});

// ============================================
// FILTRO PARA IMÁGENES
// ============================================
const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  
  if (mime && ext) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif, webp)'));
  }
};

// ============================================
// FILTRO PARA DOCUMENTOS
// ============================================
const documentFilter = (req, file, cb) => {
  const tiposPermitidos = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-rar-compressed',
    'text/csv',
    'text/plain'
  ];

  if (tiposPermitidos.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo: PDF, Word, Excel, PowerPoint, ZIP, RAR, CSV, TXT'));
  }
};

// ============================================
// 🆕 FILTRO COMBINADO (Imágenes + Documentos)
// ============================================
const combinedFilter = (req, file, cb) => {
  // Si es el campo 'imagen', validar como imagen
  if (file.fieldname === 'imagen' || file.fieldname === 'foto_perfil' || file.fieldname === 'foto_portada') {
    return imageFilter(req, file, cb);
  }
  
  // Si es el campo 'documentos', validar como documento
  if (file.fieldname === 'documentos') {
    return documentFilter(req, file, cb);
  }

  // Campo no reconocido
  cb(new Error(`Campo no permitido: ${file.fieldname}`));
};

// ============================================
// MULTER PARA IMÁGENES
// ============================================
const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
      const usuario_id = req.usuario?.id ?? 'anon';
      const ts = Date.now();
      const ext = path.extname(file.originalname).toLowerCase();
      const carpeta = file.fieldname === 'foto_perfil' 
        ? 'perfiles' 
        : file.fieldname === 'foto_portada' 
        ? 'portadas' 
        : 'publicaciones';
      const fileKey = `${carpeta}/${file.fieldname}-${usuario_id}-${ts}${ext}`;
      console.log(`📤 Subiendo imagen a S3: ${fileKey}`);
      cb(null, fileKey);
    }
  }),
  fileFilter: imageFilter,
  limits: {
    fileSize: process.env.MAX_FILE_SIZE ? Number(process.env.MAX_FILE_SIZE) : 5 * 1024 * 1024
  }
});

// ============================================
// MULTER PARA DOCUMENTOS
// ============================================
const uploadDocumentos = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
      const usuario_id = req.usuario?.id ?? 'anon';
      const ts = Date.now();
      const ext = path.extname(file.originalname).toLowerCase();
      const fileKey = `documentos/doc-${usuario_id}-${ts}${ext}`;
      console.log(`📤 Subiendo documento a S3: ${fileKey}`);
      cb(null, fileKey);
    }
  }),
  fileFilter: documentFilter,
  limits: {
    fileSize: process.env.MAX_DOC_SIZE ? Number(process.env.MAX_DOC_SIZE) : 10 * 1024 * 1024 // 10MB para docs
  }
});

// ============================================
// 🆕 MULTER PARA PUBLICACIONES (Imagen + Documentos)
// ============================================
const uploadPublicacion = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
      const usuario_id = req.usuario?.id ?? 'anon';
      const ts = Date.now();
      const random = Math.floor(Math.random() * 10000);
      const ext = path.extname(file.originalname).toLowerCase();
      
      let carpeta, fileKey;
      
      // Determinar carpeta según el tipo de archivo
      if (file.fieldname === 'imagen') {
        carpeta = 'publicaciones';
        fileKey = `${carpeta}/img-${usuario_id}-${ts}${ext}`;
      } else if (file.fieldname === 'documentos') {
        carpeta = 'documentos';
        fileKey = `${carpeta}/doc-${usuario_id}-${ts}-${random}${ext}`;
      } else {
        carpeta = 'otros';
        fileKey = `${carpeta}/file-${usuario_id}-${ts}${ext}`;
      }
      
      console.log(`📤 Subiendo archivo a S3: ${fileKey}`);
      cb(null, fileKey);
    }
  }),
  fileFilter: combinedFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB límite general
    files: 6 // Máximo: 1 imagen + 5 documentos
  }
});

// ============================================
// ELIMINAR DE S3
// ============================================
const deleteFromS3 = async (keyOrUrl) => {
  if (!keyOrUrl) return false;
  
  let Key = keyOrUrl;
  try {
    const urlPrefix = process.env.AWS_S3_URL;
    if (typeof keyOrUrl === 'string' && urlPrefix && keyOrUrl.startsWith(urlPrefix)) {
      Key = keyOrUrl.substring(urlPrefix.length + 1);
    } else if (typeof keyOrUrl === 'string' && keyOrUrl.includes('/')) {
      const parts = keyOrUrl.split('/');
      Key = parts.slice(3).join('/');
    }

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key
    };

    await s3.deleteObject(params).promise();
    console.log(`✅ Eliminado de S3: ${Key}`);
    return true;
  } catch (err) {
    console.error('❌ Error al eliminar de S3:', err.message || err);
    return false;
  }
};

// ============================================
// URL FIRMADA
// ============================================
const getSignedUrl = (key, expires = 3600) => {
  try {
    return s3.getSignedUrl('getObject', {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Expires: expires
    });
  } catch (err) {
    console.error('❌ Error al generar URL firmada:', err.message || err);
    return null;
  }
};

module.exports = {
  s3,
  upload,              // Para imágenes (perfil, portada, etc)
  uploadDocumentos,    // Para documentos individuales
  uploadPublicacion,   // 🆕 Para publicaciones (imagen + documentos)
  deleteFromS3,
  getSignedUrl
};