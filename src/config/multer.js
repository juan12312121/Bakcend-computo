const multer = require('multer');
const { storage, cloudinary } = require('./cloudinary');

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  if (allowed.test(file.originalname.toLowerCase()) || file.mimetype.startsWith('image/')) {
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

// Multer instances using Cloudinary storage
const upload = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadDocumentos = multer({ storage, fileFilter: documentFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPublicacion = multer({ storage, fileFilter: combinedFilter, limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

/**
 * Eliminar archivo de Cloudinary
 * @param {string} publicIdOrUrl 
 */
const deleteFile = async (publicIdOrUrl) => {
  if (!publicIdOrUrl) return false;
  try {
    let publicId = publicIdOrUrl;
    
    // Si es una URL completa de Cloudinary, extraer el publicId
    if (publicIdOrUrl.startsWith('http')) {
      const parts = publicIdOrUrl.split('/');
      const lastPart = parts[parts.length - 1].split('.')[0];
      const folderPart = parts[parts.length - 2];
      const trinoPart = parts[parts.length - 3];
      publicId = `${trinoPart}/${folderPart}/${lastPart}`;
    }
    
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (err) {
    console.error('❌ Error al eliminar de Cloudinary:', err.message);
    return false;
  }
};

/**
 * Cloudinary ya nos da la URL completa en file.path, 
 * así que esta función es principalmente para formatear o asegurar consistencia.
 */
const getUrl = (pathOrUrl) => {
  return pathOrUrl; // Multer-storage-cloudinary ya nos da la URL completa en el objeto de archivo
};

module.exports = { 
  upload, 
  uploadDocumentos, 
  uploadPublicacion, 
  deleteFile, 
  getUrl
};