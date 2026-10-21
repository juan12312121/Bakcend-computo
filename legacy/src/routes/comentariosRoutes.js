const express = require('express');
const router = express.Router();
const comentariosController = require('../controllers/comentariosController');
const { proteger } = require('../middlewares/auth');

/**
 * @route   POST /api/comentarios
 * @desc    Crear un nuevo comentario
 * @access  Private (requiere autenticación)
 */
router.post('/', proteger, comentariosController.crear);

/**
 * @route   GET /api/comentarios/publicacion/:publicacion_id
 * @desc    Obtener comentarios de una publicación específica
 * @access  Public
 * @query   limit, offset (paginación)
 */
router.get('/publicacion/:publicacion_id', comentariosController.obtenerPorPublicacion);

/**
 * @route   GET /api/comentarios/usuario/:usuario_id
 * @desc    Obtener comentarios de un usuario específico
 * @access  Public
 * @query   limit, offset (paginación)
 */
router.get('/usuario/:usuario_id', comentariosController.obtenerPorUsuario);

/**
 * @route   GET /api/comentarios/:id
 * @desc    Obtener un comentario específico por ID
 * @access  Public
 */
router.get('/:id', comentariosController.obtenerPorId);

/**
 * @route   PUT /api/comentarios/:id
 * @desc    Actualizar un comentario
 * @access  Private (requiere autenticación y ser dueño del comentario)
 */
router.put('/:id', proteger, comentariosController.actualizar);

/**
 * @route   DELETE /api/comentarios/:id
 * @desc    Eliminar un comentario
 * @access  Private (requiere autenticación y ser dueño del comentario)
 */
router.delete('/:id', proteger, comentariosController.eliminar);

module.exports = router;