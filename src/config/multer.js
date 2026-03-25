const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsBase = path.resolve(process.cwd(), 'src', 'uploads');

// Crear carpetas locales
const carpetas = ['perfiles', 'portadas', 'publicaciones', 'documentos'];
carpetas.forEach(carpeta => {
  const dir = path.join(uploadsBase, carpeta);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * Almacenamiento Local
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subfolder = 'publicaciones';
    if (file.fieldname === 'foto_perfil') subfolder = 'perfiles';
    else if (file.fieldname === 'foto_portada') subfolder = 'portadas';
    else if (file.fieldname === 'documentos') subfolder = 'documentos';
    
    const destino = path.join(uploadsBase, subfolder);
    if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });
    cb(null, destino);
  },
  filename: (req, file, cb) => {
    const usuario_id = req.usuario?.id ?? 'anon';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${usuario_id}-${timestamp}${ext}`);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo imágenes'));
  }
};

const documentFilter = (req, file, cb) => {
  const tiposPermitidos = [
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ];
  if (tiposPermitidos.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Documento no permitido'));
};

const combinedFilter = (req, file, cb) => {
  if (['imagen', 'foto_perfil', 'foto_portada'].includes(file.fieldname)) return imageFilter(req, file, cb);
  if (file.fieldname === 'documentos') return documentFilter(req, file, cb);
  cb(null, true);
};

const upload = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadDocumentos = multer({ storage, fileFilter: documentFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPublicacion = multer({ storage, fileFilter: combinedFilter, limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

/**
 * Eliminar archivo (se llama deleteFromS3 por compatibilidad)
 */
const deleteFile = async (urlOrPath) => {
  if (!urlOrPath) return false;
  try {
    let relativePath = urlOrPath;
    if (urlOrPath.startsWith('http')) {
        const parts = urlOrPath.split('/uploads/');
        if (parts.length > 1) relativePath = parts[1];
        else return false;
    }
    relativePath = relativePath.replace(/^\/?uploads\//, '');
    const filePath = path.join(uploadsBase, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('Error deleteFile:', err.message);
    return false;
  }
};

/**
 * Generar URL firmada (o local en este caso)
 */
const getSignedUrl = (key) => {
  const baseUrl = process.env.API_URL || 'http://localhost:3000';
  const cleanKey = key.replace(/^\/?uploads\//, '');
  return `${baseUrl}/uploads/${cleanKey}`;
};

module.exports = { 
  upload, 
  uploadDocumentos, 
  uploadPublicacion, 
  deleteFromS3: deleteFile, 
  getSignedUrl,
  s3: { deleteObject: () => ({ promise: () => Promise.resolve() }) } 
};