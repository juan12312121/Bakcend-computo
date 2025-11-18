const express = require('express');
const router = express.Router();
const { proteger } = require('../middlewares/auth');
const publicacionController = require('../controllers/publicacionesController');
const { upload, uploadPublicacion } = require('../config/aws');

/**
 * ============================================
 * RUTAS DE PUBLICACIONES CON DOCUMENTOS
 * ============================================
 * Incluye validación de censura con Gemini
 * Soporta múltiples documentos (hasta 5)
 * ============================================
 */

// Middleware de manejo de errores para multer
const handleUploadError = (err, req, res, next) => {
  if (err) {
    console.error('❌ Error de Multer:', err.message);
    return res.status(400).json({ 
      success: false, 
      mensaje: err.message || 'Error al subir archivos'
    });
  }
  next();
};

// ⚠️ RUTAS ESPECÍFICAS PRIMERO (ANTES DE /:id)

/**
 * GET /api/publicaciones/categorias
 * Obtener todas las categorías disponibles
 */
router.get('/categorias', publicacionController.obtenerCategorias);

/**
 * GET /api/publicaciones/mis-publicaciones
 * Obtener mis propias publicaciones
 * ✅ Requiere autenticación
 */
router.get('/mis-publicaciones', proteger, publicacionController.obtenerMisPublicaciones);

/**
 * GET /api/publicaciones/usuario/:usuarioId
 * Obtener publicaciones de otro usuario
 */
router.get('/usuario/:usuarioId', publicacionController.obtenerPublicacionesUsuario);

// ============================================
// 🆕 CREAR PUBLICACIÓN CON IMAGEN + DOCUMENTOS
// ============================================
/**
 * POST /api/publicaciones
 * Crear nueva publicación (con validación de censura)
 * ✅ Requiere autenticación
 * ✅ Soporta 1 imagen + hasta 5 documentos
 * ✅ Valida con Gemini
 */
router.post(
  '/',
  proteger,
  uploadPublicacion.fields([
    { name: 'imagen', maxCount: 1 },        // 1 imagen opcional
    { name: 'documentos', maxCount: 5 }     // Hasta 5 documentos
  ]),
  handleUploadError,
  publicacionController.crearPublicacion
);

/**
 * PUT /api/publicaciones/:id
 * Actualizar publicación (con re-validación de censura)
 * ✅ Requiere autenticación
 * ✅ Soporta actualizar imagen
 * ✅ Valida con Gemini
 */
router.put(
  '/:id',
  proteger,
  upload.single('imagen'),
  handleUploadError,
  publicacionController.actualizarPublicacion
);

/**
 * DELETE /api/publicaciones/:id
 * Eliminar publicación (y sus documentos)
 * ✅ Requiere autenticación
 */
router.delete('/:id', proteger, publicacionController.eliminarPublicacion);

// ============================================
// RUTAS GENERALES AL FINAL
// ============================================

/**
 * GET /api/publicaciones
 * Obtener feed de publicaciones (personalizado o aleatorio)
 */
router.get('/', proteger, publicacionController.obtenerPublicaciones);

/**
 * GET /api/publicaciones/:id
 * Obtener una publicación específica por ID
 */
router.get('/:id', publicacionController.obtenerPublicacion);

module.exports = router;