/**
 * AWS CONFIG PROXY (BACKWARD COMPATIBILITY)
 * Este archivo solo redirige al sistema de almacenamiento local (Multer Disk Storage)
 * ya que AWS S3 no se está utilizando.
 */
const multerConfig = require('./multer');

module.exports = {
  s3: multerConfig.s3,
  upload: multerConfig.upload,
  uploadDocumentos: multerConfig.uploadDocumentos,
  uploadPublicacion: multerConfig.uploadPublicacion,
  deleteFromS3: multerConfig.deleteFromS3,
  getSignedUrl: multerConfig.getSignedUrl
};