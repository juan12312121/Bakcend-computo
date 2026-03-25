const Like = require('../models/likes');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * ============================================
 * CONTROLADOR DE LIKES
 * ============================================
 * Maneja todas las operaciones de likes
 * e integración con notificaciones
 * ============================================
 */

const likeController = {
  /**
   * ========================================
   * AGREGAR LIKE
   * ========================================
   * POST /api/likes/agregar
   * Body: { publicacion_id: number }
   */
  async agregarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.body;

      if (!publicacion_id) {
        return errorResponse(res, 'Falta publicacion_id', 400);
      }

      const yaExiste = await Like.existe(publicacion_id, usuario_id);
      if (yaExiste) {
        return errorResponse(res, 'Ya diste like a esta publicación', 400);
      }

      await Like.crear(publicacion_id, usuario_id);
      await Like.incrementarTotalPublicacion(publicacion_id);

      // ✅ CREAR NOTIFICACIÓN
      await Notificacion.crearNotificacionLike(publicacion_id, usuario_id);

      console.log(`❤️ Usuario ${usuario_id} dio like a publicación ${publicacion_id}`);

      // 🆕 Notificar cambio por sockets
      if (global.io) {
        const total = await Like.obtenerTotal(publicacion_id);
        global.io.emit('like_update', { publicacion_id, total });
      }

      return successResponse(res, null, 'Like agregado correctamente', 201);
    } catch (error) {
      console.error('❌ Error en agregarLike:', error);
      return errorResponse(res, 'Error al agregar like', 500);
    }
  },

  /**
   * ========================================
   * ELIMINAR LIKE
   * ========================================
   * DELETE /api/likes/eliminar
   * Body: { publicacion_id: number }
   */
  async eliminarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.body;

      if (!publicacion_id) {
        return errorResponse(res, 'Falta publicacion_id', 400);
      }

      const existe = await Like.existe(publicacion_id, usuario_id);
      if (!existe) {
        return errorResponse(res, 'No has dado like a esta publicación', 404);
      }

      await Like.eliminar(publicacion_id, usuario_id);
      await Like.decrementarTotalPublicacion(publicacion_id);

      // ✅ ELIMINAR NOTIFICACIÓN
      await Notificacion.eliminarNotificacionLike(publicacion_id, usuario_id);

      console.log(`💔 Usuario ${usuario_id} quitó like de publicación ${publicacion_id}`);

      // 🆕 Notificar cambio por sockets
      if (global.io) {
        const total = await Like.obtenerTotal(publicacion_id);
        global.io.emit('like_update', { publicacion_id, total });
      }

      return successResponse(res, null, 'Like eliminado correctamente', 200);
    } catch (error) {
      console.error('❌ Error en eliminarLike:', error);
      return errorResponse(res, 'Error al eliminar like', 500);
    }
  },

  /**
   * ========================================
   * TOGGLE LIKE
   * ========================================
   * POST /api/likes/toggle
   * Body: { publicacion_id: number }
   */
  async toggleLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.body;

      if (!publicacion_id) {
        return errorResponse(res, 'Falta publicacion_id', 400);
      }

      const existe = await Like.existe(publicacion_id, usuario_id);

      if (existe) {
        // ELIMINAR LIKE
        await Like.eliminar(publicacion_id, usuario_id);
        await Like.decrementarTotalPublicacion(publicacion_id);
        await Notificacion.eliminarNotificacionLike(publicacion_id, usuario_id);
        
        console.log(`💔 Usuario ${usuario_id} quitó like de publicación ${publicacion_id}`);
        
        // 🆕 Notificar cambio por sockets
        if (global.io) {
          const total = await Like.obtenerTotal(publicacion_id);
          global.io.emit('like_update', { publicacion_id, total });
        }
        
        return successResponse(res, { liked: false }, 'Like eliminado', 200);
      } else {
        // AGREGAR LIKE
        await Like.crear(publicacion_id, usuario_id);
        await Like.incrementarTotalPublicacion(publicacion_id);
        await Notificacion.crearNotificacionLike(publicacion_id, usuario_id);
        
        console.log(`❤️ Usuario ${usuario_id} dio like a publicación ${publicacion_id}`);
        
        // 🆕 Notificar cambio por sockets
        if (global.io) {
          const total = await Like.obtenerTotal(publicacion_id);
          global.io.emit('like_update', { publicacion_id, total });
        }
        
        return successResponse(res, { liked: true }, 'Like agregado', 201);
      }
    } catch (error) {
      console.error('❌ Error en toggleLike:', error);
      return errorResponse(res, 'Error al alternar like', 500);
    }
  },

  /**
   * ========================================
   * OBTENER LIKES DE UNA PUBLICACIÓN
   * ========================================
   * GET /api/likes/publicacion/:publicacion_id?limit=50&offset=0
   */
  async obtenerLikesPublicacion(req, res) {
    try {
      const { publicacion_id } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      const likes = await Like.obtenerPorPublicacion(
        publicacion_id,
        parseInt(limit),
        parseInt(offset)
      );

      return successResponse(res, { likes }, 'Likes obtenidos correctamente', 200);
    } catch (error) {
      console.error('❌ Error en obtenerLikesPublicacion:', error);
      return errorResponse(res, 'Error al obtener likes', 500);
    }
  },

  /**
   * ========================================
   * VERIFICAR SI USUARIO DIO LIKE
   * ========================================
   * GET /api/likes/verificar/:publicacion_id
   */
  async verificarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.params;

      const existe = await Like.existe(publicacion_id, usuario_id);

      return successResponse(res, { liked: existe }, 'Estado del like verificado', 200);
    } catch (error) {
      console.error('❌ Error en verificarLike:', error);
      return errorResponse(res, 'Error al verificar like', 500);
    }
  },

  /**
   * ========================================
   * OBTENER TOTAL DE LIKES
   * ========================================
   * GET /api/likes/total/:publicacion_id
   */
  async obtenerTotalLikes(req, res) {
    try {
      const { publicacion_id } = req.params;
      const total = await Like.obtenerTotal(publicacion_id);

      return successResponse(res, { total }, 'Total de likes obtenido', 200);
    } catch (error) {
      console.error('❌ Error en obtenerTotalLikes:', error);
      return errorResponse(res, 'Error al obtener total de likes', 500);
    }
  },

  /**
   * ========================================
   * OBTENER MIS LIKES
   * ========================================
   * GET /api/likes/mis-likes?limit=50&offset=0
   */
  async obtenerMisLikes(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { limit = 50, offset = 0 } = req.query;

      const likes = await Like.obtenerPorUsuario(
        usuario_id,
        parseInt(limit),
        parseInt(offset)
      );

      return successResponse(res, { likes }, 'Likes del usuario obtenidos correctamente', 200);
    } catch (error) {
      console.error('❌ Error en obtenerMisLikes:', error);
      return errorResponse(res, 'Error al obtener likes del usuario', 500);
    }
  }
};

module.exports = likeController;