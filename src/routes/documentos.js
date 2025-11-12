const express = require('express');
const router = express.Router();
const { proteger } = require('../middlewares/auth');
const documentosController = require('../controllers/documentosController');
const { uploadDocumentos } = require('../config/aws');

// Middleware de manejo de errores para multer
const handleUploadError = (err, req, res, next) => {
  if (err) {
    return res.status(400).json({ 
      success: false, 
      error: err.message || 'Error al subir documento'
    });
  }
  next();
};

// ============================================
// ⚠️ RUTAS ESPECÍFICAS PRIMERO (ANTES DE /:id)
// ============================================

// Obtener mis documentos - DEBE IR ANTES DE /:id
router.get('/mis-documentos', proteger, documentosController.obtenerMisDocumentos);

// Subir documento
router.post(
  '/', 
  proteger, 
  uploadDocumentos.single('documento'),
  handleUploadError,
  documentosController.subirDocumento
);

// Actualizar documento
router.put(
  '/:id', 
  proteger, 
  uploadDocumentos.single('documento'),
  handleUploadError,
  documentosController.actualizarDocumento
);

// Eliminar documento
router.delete('/:id', proteger, documentosController.eliminarDocumento);

// ============================================
// RUTAS PÚBLICAS (AL FINAL)
// ============================================

// Obtener todos los documentos
router.get('/', documentosController.obtenerTodosDocumentos);

// Obtener documento por ID - DEBE IR AL FINAL
router.get('/:id', documentosController.obtenerDocumento);

module.exports = router;