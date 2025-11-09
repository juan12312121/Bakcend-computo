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

// Validar tipo de archivo (solo imágenes)
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (mime && ext) cb(null, true);
  else cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif, webp)'));
};

// Multer + S3 (sin ACL)
const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET_NAME,
    // NO usar `acl` si el bucket tiene ACLs deshabilitadas
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
      console.log(`📤 Subiendo a S3: ${fileKey}`);
      cb(null, fileKey);
    }
  }),
  fileFilter,
  limits: { fileSize: (process.env.MAX_FILE_SIZE ? Number(process.env.MAX_FILE_SIZE) : 5 * 1024 * 1024) }
});

// deleteFromS3 acepta key o URL completa
const deleteFromS3 = async (keyOrUrl) => {
  if (!keyOrUrl) return false;
  // si recibe URL, extraer key después del bucket root
  let Key = keyOrUrl;
  try {
    const urlPrefix = process.env.AWS_S3_URL;
    if (typeof keyOrUrl === 'string' && urlPrefix && keyOrUrl.startsWith(urlPrefix)) {
      Key = keyOrUrl.substring(urlPrefix.length + 1); // quitar slash
    } else if (typeof keyOrUrl === 'string' && keyOrUrl.includes('/')) {
      // fallback: tomar todo después del bucket host
      const parts = keyOrUrl.split('/');
      Key = parts.slice(3).join('/'); // http(s)://host/key...
    }
    const params = { Bucket: process.env.AWS_BUCKET_NAME, Key };
    await s3.deleteObject(params).promise();
    console.log(`✅ Eliminado de S3: ${Key}`);
    return true;
  } catch (err) {
    console.error('❌ Error al eliminar de S3:', err.message || err);
    return false;
  }
};

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
  upload,
  deleteFromS3,
  getSignedUrl
};
