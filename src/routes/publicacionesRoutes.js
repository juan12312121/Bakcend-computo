const express = require('express');
const router = express.Router();
const { proteger } = require('../middlewares/auth');
const publicacionController = require('../controllers/publicacionesController');
const { upload, uploadPublicacion } = require('../config/aws');

/**
 * ============================================
 * RUTAS DE PUBLICACIONES CON DOCUMENTOS + VISIBILIDAD
 * ============================================
 * Incluye validación de censura con Gemini
 * Soporta múltiples documentos (hasta 5)
 * Control de visibilidad: público, privado, seguidores
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
 * 🆕 GET /api/publicaciones/visibilidades
 * Obtener opciones de visibilidad disponibles
 */
router.get('/visibilidades', publicacionController.obtenerVisibilidades);

/**
 * GET /api/publicaciones/mis-publicaciones
 * Obtener mis propias publicaciones (incluyendo privadas)
 * ✅ Requiere autenticación
 */
router.get('/mis-publicaciones', proteger, publicacionController.obtenerMisPublicaciones);

/**
 * GET /api/publicaciones/usuario/:usuarioId
 * Obtener publicaciones de otro usuario (respetando visibilidad)
 */
router.get('/usuario/:usuarioId', publicacionController.obtenerPublicacionesUsuario);

// ============================================
// 🆕 CREAR PUBLICACIÓN CON IMAGEN + DOCUMENTOS + VISIBILIDAD
// ============================================
/**
 * POST /api/publicaciones
 * Crear nueva publicación (con validación de censura y visibilidad)
 * ✅ Requiere autenticación
 * ✅ Soporta 1 imagen + hasta 5 documentos
 * ✅ Valida con Gemini
 * ✅ Permite configurar visibilidad: publico, privado, seguidores
 * 
 * Body params:
 * - contenido: string (obligatorio)
 * - categoria: string (opcional, default: General)
 * - visibilidad: enum('publico', 'privado', 'seguidores') (opcional, default: publico)
 * - imagen: file (opcional)
 * - documentos: files[] (opcional, máx 5)
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
 * Actualizar publicación (con re-validación de censura y visibilidad)
 * ✅ Requiere autenticación
 * ✅ Soporta actualizar imagen
 * ✅ Permite cambiar visibilidad
 * ✅ Valida con Gemini
 * 
 * Body params:
 * - contenido: string (opcional)
 * - categoria: string (opcional)
 * - visibilidad: enum('publico', 'privado', 'seguidores') (opcional)
 * - imagen: file (opcional)
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
 * - Usuario autenticado: ve públicas + propias + de seguidores (según visibilidad)
 * - Usuario no autenticado: solo ve públicas
 */
router.get('/', proteger, publicacionController.obtenerPublicaciones);

/**
 * GET /api/publicaciones/:id
 * Obtener una publicación específica por ID (respetando visibilidad)
 * - Pública: todos pueden ver
 * - Privada: solo el autor
 * - Seguidores: solo seguidores del autor
 */
router.get('/:id', publicacionController.obtenerPublicacion);

module.exports = router;