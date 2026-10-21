const Like = require('../models/likes');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * ============================================
 * CONTROLADOR DE LIKES
 * ============================================
 */

const likeController = {
  /**
   * AGREGAR LIKE
   */
  async agregarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.body;
      if (!publicacion_id) return errorResponse(res, 'Falta publicacion_id', 400);

      const yaExiste = await Like.existe(publicacion_id, usuario_id);
      if (yaExiste) return errorResponse(res, 'Ya diste like', 400);

      await Like.crear(publicacion_id, usuario_id);
      await Like.incrementarTotalPublicacion(publicacion_id);
      await Notificacion.crearNotificacionLike(publicacion_id, usuario_id);

      const total_likes = await Like.obtenerTotal(publicacion_id);
      if (global.io) global.io.emit('like_update', { publicacion_id, total: total_likes });

      return successResponse(res, { liked: true, usuario_dio_like: true, total_likes }, 'Like agregado', 201);
    } catch (error) {
      return errorResponse(res, 'Error al agregar like', 500);
    }
  },

  /**
   * ELIMINAR LIKE
   */
  async eliminarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.body;
      if (!publicacion_id) return errorResponse(res, 'Falta publicacion_id', 400);

      const existe = await Like.existe(publicacion_id, usuario_id);
      if (!existe) return errorResponse(res, 'No has dado like', 404);

      await Like.eliminar(publicacion_id, usuario_id);
      await Like.decrementarTotalPublicacion(publicacion_id);
      await Notificacion.eliminarNotificacionLike(publicacion_id, usuario_id);

      const total_likes = await Like.obtenerTotal(publicacion_id);
      if (global.io) global.io.emit('like_update', { publicacion_id, total: total_likes });

      return successResponse(res, { liked: false, usuario_dio_like: false, total_likes }, 'Like eliminado', 200);
    } catch (error) {
      return errorResponse(res, 'Error al eliminar like', 500);
    }
  },

  /**
   * TOGGLE LIKE
   */
  async toggleLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.body;
      if (!publicacion_id) return errorResponse(res, 'Falta publicacion_id', 400);

      const existe = await Like.existe(publicacion_id, usuario_id);

      if (existe) {
        await Like.eliminar(publicacion_id, usuario_id);
        await Like.decrementarTotalPublicacion(publicacion_id);
        await Notificacion.eliminarNotificacionLike(publicacion_id, usuario_id);
        const total_likes = await Like.obtenerTotal(publicacion_id);
        if (global.io) global.io.emit('like_update', { publicacion_id, total: total_likes });
        return successResponse(res, { liked: false, usuario_dio_like: false, total_likes }, 'Like eliminado', 200);
      } else {
        await Like.crear(publicacion_id, usuario_id);
        await Like.incrementarTotalPublicacion(publicacion_id);
        await Notificacion.crearNotificacionLike(publicacion_id, usuario_id);
        const total_likes = await Like.obtenerTotal(publicacion_id);
        if (global.io) global.io.emit('like_update', { publicacion_id, total: total_likes });
        return successResponse(res, { liked: true, usuario_dio_like: true, total_likes }, 'Like agregado', 201);
      }
    } catch (error) {
      return errorResponse(res, 'Error al alternar like', 500);
    }
  },

  /**
   * VERIFICAR SI USUARIO DIO LIKE
   */
  async verificarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.params;
      const existe = await Like.existe(publicacion_id, usuario_id);
      const total = await Like.obtenerTotal(publicacion_id);
      return successResponse(res, { liked: existe, usuario_dio_like: existe, total_likes: total }, 'Estado verificado', 200);
    } catch (error) {
      return errorResponse(res, 'Error', 500);
    }
  },

  /**
   * OTROS MÉTODOS
   */
  async obtenerLikesPublicacion(req, res) {
    try {
      const { publicacion_id } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const likes = await Like.obtenerPorPublicacion(publicacion_id, parseInt(limit), parseInt(offset));
      return successResponse(res, { likes }, 'Likes obtenidos', 200);
    } catch (error) {
      return errorResponse(res, 'Error', 500);
    }
  },

  async obtenerTotalLikes(req, res) {
    try {
      const { publicacion_id } = req.params;
      const total = await Like.obtenerTotal(publicacion_id);
      return successResponse(res, { total, total_likes: total }, 'Total obtenido', 200);
    } catch (error) {
       return errorResponse(res, 'Error', 500);
    }
  },

  async obtenerMisLikes(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { limit = 50, offset = 0 } = req.query;
      const likes = await Like.obtenerPorUsuario(usuario_id, parseInt(limit), parseInt(offset));
      return successResponse(res, { likes }, 'Mis likes', 200);
    } catch (error) {
       return errorResponse(res, 'Error', 500);
    }
  }
};

module.exports = likeController;