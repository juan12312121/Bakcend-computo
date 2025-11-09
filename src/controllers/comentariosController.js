const Comentario = require('../models/Comentario');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * ============================================
 * CONTROLADOR DE COMENTARIOS
 * ============================================
 * Maneja todas las operaciones de comentarios
 * e integración con notificaciones
 * ============================================
 */

const comentarioController = {

  /**
   * ========================================
   * CREAR COMENTARIO
   * ========================================
   * POST /api/comentarios
   */
  async crear(req, res) {
    try {
      const { publicacion_id, texto } = req.body;
      const usuario_id = req.usuario.id;

      // Validaciones
      if (!publicacion_id || !texto) {
        return errorResponse(res, 'El ID de publicación y el texto son requeridos', 400);
      }

      if (texto.trim().length === 0) {
        return errorResponse(res, 'El comentario no puede estar vacío', 400);
      }

      if (texto.length > 1000) {
        return errorResponse(res, 'El comentario no puede exceder 1000 caracteres', 400);
      }

      const comentarioId = await Comentario.crear(publicacion_id, usuario_id, texto);
      
      // ✅ CREAR NOTIFICACIÓN DE COMENTARIO
      await Notificacion.crearNotificacionComentario(publicacion_id, usuario_id);
      
      const comentario = await Comentario.obtenerPorId(comentarioId);

      console.log(`💬 Usuario ${usuario_id} comentó en publicación ${publicacion_id}`);

      return successResponse(
        res,
        comentario,
        'Comentario creado exitosamente',
        201
      );
    } catch (error) {
      console.error('❌ Error al crear comentario:', error);
      return errorResponse(res, 'Error al crear el comentario', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIOS POR PUBLICACIÓN
   * ========================================
   * GET /api/comentarios/publicacion/:publicacion_id
   */
  async obtenerPorPublicacion(req, res) {
    try {
      const { publicacion_id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const comentarios = await Comentario.obtenerPorPublicacion(publicacion_id, limit, offset);
      const total = await Comentario.contarPorPublicacion(publicacion_id);

      return successResponse(
        res,
        {
          comentarios,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        },
        'Comentarios obtenidos correctamente',
        200
      );
    } catch (error) {
      console.error('❌ Error al obtener comentarios:', error);
      return errorResponse(res, 'Error al obtener los comentarios', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIOS POR USUARIO
   * ========================================
   * GET /api/comentarios/usuario/:usuario_id
   */
  async obtenerPorUsuario(req, res) {
    try {
      const { usuario_id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const comentarios = await Comentario.obtenerPorUsuario(usuario_id, limit, offset);

      return successResponse(
        res,
        {
          comentarios,
          pagination: { limit, offset }
        },
        'Comentarios del usuario obtenidos correctamente',
        200
      );
    } catch (error) {
      console.error('❌ Error al obtener comentarios del usuario:', error);
      return errorResponse(res, 'Error al obtener los comentarios del usuario', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIO POR ID
   * ========================================
   * GET /api/comentarios/:id
   */
  async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      const comentario = await Comentario.obtenerPorId(id);

      if (!comentario) {
        return errorResponse(res, 'Comentario no encontrado', 404);
      }

      return successResponse(res, comentario, 'Comentario obtenido correctamente', 200);
    } catch (error) {
      console.error('❌ Error al obtener comentario:', error);
      return errorResponse(res, 'Error al obtener el comentario', 500);
    }
  },

  /**
   * ========================================
   * ACTUALIZAR COMENTARIO
   * ========================================
   * PUT /api/comentarios/:id
   */
  async actualizar(req, res) {
    try {
      const { id } = req.params;
      const { texto } = req.body;
      const usuario_id = req.usuario.id;

      if (!texto) {
        return errorResponse(res, 'El texto es requerido', 400);
      }

      if (texto.trim().length === 0) {
        return errorResponse(res, 'El comentario no puede estar vacío', 400);
      }

      if (texto.length > 1000) {
        return errorResponse(res, 'El comentario no puede exceder 1000 caracteres', 400);
      }

      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return errorResponse(res, 'No tienes permiso para editar este comentario', 403);
      }

      const actualizado = await Comentario.actualizar(id, texto);

      if (!actualizado) {
        return errorResponse(res, 'Comentario no encontrado', 404);
      }

      const comentario = await Comentario.obtenerPorId(id);

      console.log(`✏️ Usuario ${usuario_id} actualizó comentario ${id}`);

      return successResponse(
        res,
        comentario,
        'Comentario actualizado exitosamente',
        200
      );
    } catch (error) {
      console.error('❌ Error al actualizar comentario:', error);
      return errorResponse(res, 'Error al actualizar el comentario', 500);
    }
  },

  /**
   * ========================================
   * ELIMINAR COMENTARIO
   * ========================================
   * DELETE /api/comentarios/:id
   */
  async eliminar(req, res) {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return errorResponse(res, 'No tienes permiso para eliminar este comentario', 403);
      }

      const eliminado = await Comentario.eliminar(id);

      if (!eliminado) {
        return errorResponse(res, 'Comentario no encontrado', 404);
      }

      // ⚠️ NOTA: NO eliminamos la notificación del comentario
      // porque pueden haber múltiples comentarios del mismo usuario
      // Solo se eliminan cuando se elimina la publicación completa

      console.log(`🗑️ Usuario ${usuario_id} eliminó comentario ${id}`);

      return successResponse(res, null, 'Comentario eliminado exitosamente', 200);
    } catch (error) {
      console.error('❌ Error al eliminar comentario:', error);
      return errorResponse(res, 'Error al eliminar el comentario', 500);
    }
  }
};

module.exports = comentarioController;