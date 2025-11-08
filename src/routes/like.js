const express = require('express');
const router = express.Router();
const likeController = require('../controllers/likeCotroller');
const { proteger } = require('../middlewares/auth');

/**
 * RUTAS DE LIKES
 * Todas las rutas para gestionar likes de publicaciones
 */

/**
 * POST /api/likes/agregar
 * Agregar un like a una publicación
 * Body: { publicacion_id: number }
 * Requiere: autenticación
 */
router.post('/agregar', proteger, likeController.agregarLike);

/**
 * DELETE /api/likes/eliminar
 * Eliminar un like de una publicación
 * Body: { publicacion_id: number }
 * Requiere: autenticación
 */
router.delete('/eliminar', proteger, likeController.eliminarLike);

/**
 * POST /api/likes/toggle
 * Agregar o eliminar like automáticamente (RECOMENDADO)
 * Body: { publicacion_id: number }
 * Requiere: autenticación
 */
router.post('/toggle', proteger, likeController.toggleLike);

/**
 * GET /api/likes/publicacion/:publicacion_id
 * Obtener todos los likes de una publicación
 * Query: ?limit=50&offset=0
 * No requiere: autenticación
 */
router.get('/publicacion/:publicacion_id', likeController.obtenerLikesPublicacion);

/**
 * GET /api/likes/verificar/:publicacion_id
 * Verificar si el usuario ha dado like a la publicación
 * Requiere: autenticación
 */
router.get('/verificar/:publicacion_id', proteger, likeController.verificarLike);

/**
 * GET /api/likes/total/:publicacion_id
 * Obtener total de likes de una publicación
 * No requiere: autenticación
 */
router.get('/total/:publicacion_id', likeController.obtenerTotalLikes);

/**
 * GET /api/likes/usuario/mis-likes
 * Obtener todos los likes del usuario actual
 * Query: ?limit=50&offset=0
 * Requiere: autenticación
 */
router.get('/usuario/mis-likes', proteger, likeController.obtenerMisLikes);

module.exports = router;