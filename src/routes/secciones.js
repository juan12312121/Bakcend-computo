// ==================== routes/secciones.routes.js ====================
const express = require('express');
const router = express.Router();
const seccionesController = require('../controllers/seccionesController');
const { proteger } = require('../middlewares/auth');

// ==================== RUTAS DE SECCIONES ====================

/**
 * @route   POST /api/secciones
 * @desc    Crear una nueva sección
 * @access  Privado (requiere autenticación)
 * @body    { nombre, icono?, color? }
 */
router.post('/', proteger, seccionesController.crearSeccion);

/**
 * @route   GET /api/secciones
 * @desc    Obtener todas las secciones del usuario autenticado
 * @access  Privado (requiere autenticación)
 */
router.get('/', proteger, seccionesController.obtenerMisSecciones);

/**
 * @route   GET /api/secciones/:id
 * @desc    Obtener una sección específica con sus posts
 * @access  Privado (requiere autenticación)
 * @params  id - ID de la sección
 */
router.get('/:id', proteger, seccionesController.obtenerSeccion);

/**
 * @route   PUT /api/secciones/:id
 * @desc    Actualizar una sección
 * @access  Privado (requiere autenticación)
 * @params  id - ID de la sección
 * @body    { nombre?, icono?, color? }
 */
router.put('/:id', proteger, seccionesController.actualizarSeccion);

/**
 * @route   DELETE /api/secciones/:id
 * @desc    Eliminar una sección
 * @access  Privado (requiere autenticación)
 * @params  id - ID de la sección
 */
router.delete('/:id', proteger, seccionesController.eliminarSeccion);

// ==================== RUTAS DE RELACIÓN SECCIONES-POSTS ====================

/**
 * @route   POST /api/secciones/posts/agregar
 * @desc    Agregar un post a una sección
 * @access  Privado (requiere autenticación)
 * @body    { seccion_id, publicacion_id }
 */
router.post('/posts/agregar', proteger, seccionesController.agregarPostASeccion);

/**
 * @route   POST /api/secciones/posts/quitar
 * @desc    Quitar un post de una sección
 * @access  Privado (requiere autenticación)
 * @body    { seccion_id, publicacion_id }
 */
router.post('/posts/quitar', proteger, seccionesController.quitarPostDeSeccion);

/**
 * @route   GET /api/secciones/posts/:publicacion_id
 * @desc    Obtener todas las secciones de un post específico
 * @access  Privado (requiere autenticación)
 * @params  publicacion_id - ID de la publicación
 */
router.get('/posts/:publicacion_id', proteger, seccionesController.obtenerSeccionesDePost);

module.exports = router;