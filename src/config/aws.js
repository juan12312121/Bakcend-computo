const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsBase = path.join(__dirname, '../uploads');

// Crear carpetas
['perfiles', 'portadas', 'publicaciones', 'documentos'].forEach(carpeta => {
  const dir = path.join(uploadsBase, carpeta);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let destino;
    if (file.fieldname === 'foto_perfil') destino = path.join(uploadsBase, 'perfiles');
    else if (file.fieldname === 'foto_portada') destino = path.join(uploadsBase, 'portadas');
    else if (file.fieldname === 'documentos') destino = path.join(uploadsBase, 'documentos');
    else destino = path.join(uploadsBase, 'publicaciones');
    cb(null, destino);
  },
  filename: (req, file, cb) => {
    const usuario_id = req.usuario?.id ?? 'anon';
    const ts = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${usuario_id}-${ts}-${random}${ext}`);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo imágenes (jpeg, jpg, png, gif, webp)'));
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
  else cb(new Error('Tipo de archivo no permitido'));
};

const combinedFilter = (req, file, cb) => {
  if (['imagen', 'foto_perfil', 'foto_portada'].includes(file.fieldname)) return imageFilter(req, file, cb);
  if (file.fieldname === 'documentos') return documentFilter(req, file, cb);
  cb(new Error(`Campo no permitido: ${file.fieldname}`));
};

const upload = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDocumentos = multer({ storage, fileFilter: documentFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPublicacion = multer({ storage, fileFilter: combinedFilter, limits: { fileSize: 10 * 1024 * 1024, files: 6 } });

// Simular deleteFromS3 con disco local
const deleteFromS3 = async (keyOrUrl) => {
  if (!keyOrUrl) return false;
  try {
    const filePath = keyOrUrl.startsWith('/') ? keyOrUrl : path.join(uploadsBase, keyOrUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`✅ Archivo eliminado: ${filePath}`);
    }
    return true;
  } catch (err) {
    console.error('❌ Error al eliminar archivo:', err.message);
    return false;
  }
};

const getSignedUrl = (key) => {
  return `${process.env.API_URL}/uploads/${key}`;
};

// s3 simulado para no romper imports
const s3 = {
  headBucket: () => ({ promise: () => Promise.resolve() }),
  listObjectsV2: () => ({ promise: () => Promise.resolve({ Contents: [] }) }),
  deleteObject: () => ({ promise: () => Promise.resolve() }),
  getSignedUrl: () => ''
};

module.exports = { s3, upload, uploadDocumentos, uploadPublicacion, deleteFromS3, getSignedUrl };