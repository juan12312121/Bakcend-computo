// routes/seccionesRoutes.js
const express = require('express');
const router = express.Router();
const seccionesController = require('../controllers/seccionesController');
const { proteger, opcional } = require('../middlewares/auth');

// ==================== RUTAS PÚBLICAS (sin autenticación obligatoria) ====================

/**
 * Obtener secciones públicas de un usuario específico
 * GET /api/secciones/usuario/:usuario_id
 * Acceso: Público (cualquier usuario puede ver)
 */
router.get('/usuario/:usuario_id', seccionesController.obtenerSeccionesDeUsuario);

/**
 * Obtener una sección pública específica con sus posts
 * GET /api/secciones/usuario/:usuario_id/seccion/:seccion_id
 * Acceso: Público
 */
router.get('/usuario/:usuario_id/seccion/:seccion_id', seccionesController.obtenerSeccionPublica);

// ==================== RUTAS PRIVADAS (autenticación requerida) ====================

/**
 * CRUD de secciones propias
 */
router.post('/', proteger, seccionesController.crearSeccion);
router.get('/', proteger, seccionesController.obtenerMisSecciones);
router.get('/:id', proteger, seccionesController.obtenerSeccion);
router.put('/:id', proteger, seccionesController.actualizarSeccion);
router.delete('/:id', proteger, seccionesController.eliminarSeccion);

/**
 * Gestión de posts en secciones propias
 */
router.post('/posts/agregar', proteger, seccionesController.agregarPostASeccion);
router.post('/posts/quitar', proteger, seccionesController.quitarPostDeSeccion);
router.get('/posts/:publicacion_id', proteger, seccionesController.obtenerSeccionesDePost);

module.exports = router;