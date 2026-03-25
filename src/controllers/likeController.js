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
   * ========================================
   * TOGGLE LIKE
   * ========================================
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
        
        const total_likes = await Like.obtenerTotal(publicacion_id);
        
        // Sockets
        if (global.io) {
          global.io.emit('like_update', { publicacion_id, total: total_likes });
        }
        
        return successResponse(res, { 
          liked: false, 
          usuario_dio_like: false, 
          total_likes 
        }, 'Like eliminado', 200);
      } else {
        // AGREGAR LIKE
        await Like.crear(publicacion_id, usuario_id);
        await Like.incrementarTotalPublicacion(publicacion_id);
        await Notificacion.crearNotificacionLike(publicacion_id, usuario_id);
        
        console.log(`❤️ Usuario ${usuario_id} dio like a publicación ${publicacion_id}`);
        
        const total_likes = await Like.obtenerTotal(publicacion_id);
        
        // Sockets
        if (global.io) {
          global.io.emit('like_update', { publicacion_id, total: total_likes });
        }
        
        return successResponse(res, { 
          liked: true, 
          usuario_dio_like: true, 
          total_likes 
        }, 'Like agregado', 201);
      }
    } catch (error) {
      console.error('❌ Error en toggleLike:', error);
      return errorResponse(res, 'Error al alternar like', 500);
    }
  },

  /**
   * ========================================
   * VERIFICAR SI USUARIO DIO LIKE
   * ========================================
   */
  async verificarLike(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { publicacion_id } = req.params;

      const existe = await Like.existe(publicacion_id, usuario_id);
      const total = await Like.obtenerTotal(publicacion_id);

      console.log(`🔍 Verificando like: Publicación ${publicacion_id}, Usuario ${usuario_id}, Existe: ${existe}`);

      return successResponse(res, { 
        liked: existe, 
        usuario_dio_like: existe, 
        total_likes: total 
      }, 'Estado del like verificado', 200);
    } catch (error) {
      console.error('❌ Error en verificarLike:', error);
      return errorResponse(res, 'Error al verificar like', 500);
    }
  },

  /**
   * ========================================
   * OTROS MÉTODOS MANTENIDOS PARA COMPATIBILIDAD
   * ========================================
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