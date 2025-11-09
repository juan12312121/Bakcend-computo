const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * ============================================
 * CONTROLADOR DE NOTIFICACIONES
 * ============================================
 * Maneja todas las operaciones de notificaciones
 * para el usuario autenticado
 * ============================================
 */

const NotificacionController = {
  
  /**
   * ========================================
   * OBTENER TODAS LAS NOTIFICACIONES
   * ========================================
   * GET /api/notificaciones?limit=20&offset=0
   */
  async obtenerTodas(req, res) {
    try {
      const usuario_id = req.usuario.id;
      const { limit = 20, offset = 0 } = req.query;

      const notificaciones = await Notificacion.obtenerPorUsuario(
        usuario_id,
        parseInt(limit),
        parseInt(offset)
      );

      console.log(`📬 Usuario ${usuario_id} obtuvo ${notificaciones.length} notificaciones`);

      return successResponse(
        res,
        {
          notificaciones,
          total: notificaciones.length,
          limit: parseInt(limit),
          offset: parseInt(offset)
        },
        'Notificaciones obtenidas correctamente',
        200
      );

    } catch (error) {
      console.error('❌ Error en obtenerTodas:', error);
      return errorResponse(res, 'Error al obtener notificaciones', 500);
    }
  },

  /**
   * ========================================
   * OBTENER NOTIFICACIONES NO LEÍDAS
   * ========================================
   * GET /api/notificaciones/no-leidas
   */
  async obtenerNoLeidas(req, res) {
    try {
      const usuario_id = req.usuario.id;

      const notificaciones = await Notificacion.obtenerNoLeidas(usuario_id);

      console.log(`📬 Usuario ${usuario_id} tiene ${notificaciones.length} notificaciones no leídas`);

      return successResponse(
        res,
        {
          notificaciones,
          total: notificaciones.length
        },
        'Notificaciones no leídas obtenidas',
        200
      );

    } catch (error) {
      console.error('❌ Error en obtenerNoLeidas:', error);
      return errorResponse(res, 'Error al obtener notificaciones no leídas', 500);
    }
  },

  /**
   * ========================================
   * CONTAR NOTIFICACIONES NO LEÍDAS
   * ========================================
   * GET /api/notificaciones/contador
   * 
   * Útil para mostrar el badge en el icono de notificaciones
   */
  async contarNoLeidas(req, res) {
    try {
      const usuario_id = req.usuario.id;

      const total = await Notificacion.contarNoLeidas(usuario_id);

      return successResponse(
        res,
        { total },
        'Contador obtenido',
        200
      );

    } catch (error) {
      console.error('❌ Error en contarNoLeidas:', error);
      return errorResponse(res, 'Error al contar notificaciones', 500);
    }
  },

  /**
   * ========================================
   * MARCAR UNA NOTIFICACIÓN COMO LEÍDA
   * ========================================
   * PUT /api/notificaciones/:id/leer
   */
  async marcarComoLeida(req, res) {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      const actualizada = await Notificacion.marcarComoLeida(id, usuario_id);

      if (!actualizada) {
        return errorResponse(res, 'Notificación no encontrada', 404);
      }

      console.log(`✅ Usuario ${usuario_id} marcó como leída la notificación ${id}`);

      return successResponse(
        res,
        { leida: true },
        'Notificación marcada como leída',
        200
      );

    } catch (error) {
      console.error('❌ Error en marcarComoLeida:', error);
      return errorResponse(res, 'Error al marcar notificación como leída', 500);
    }
  },

  /**
   * ========================================
   * MARCAR TODAS LAS NOTIFICACIONES COMO LEÍDAS
   * ========================================
   * PUT /api/notificaciones/leer-todas
   */
  async marcarTodasComoLeidas(req, res) {
    try {
      const usuario_id = req.usuario.id;

      const totalActualizadas = await Notificacion.marcarTodasComoLeidas(usuario_id);

      console.log(`✅ Usuario ${usuario_id} marcó ${totalActualizadas} notificaciones como leídas`);

      return successResponse(
        res,
        { 
          actualizadas: totalActualizadas,
          mensaje: totalActualizadas === 0 
            ? 'No hay notificaciones pendientes' 
            : `${totalActualizadas} notificaciones marcadas como leídas`
        },
        'Notificaciones actualizadas',
        200
      );

    } catch (error) {
      console.error('❌ Error en marcarTodasComoLeidas:', error);
      return errorResponse(res, 'Error al marcar todas las notificaciones como leídas', 500);
    }
  },

  /**
   * ========================================
   * ELIMINAR UNA NOTIFICACIÓN
   * ========================================
   * DELETE /api/notificaciones/:id
   */
  async eliminar(req, res) {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      const eliminada = await Notificacion.eliminar(id, usuario_id);

      if (!eliminada) {
        return errorResponse(res, 'Notificación no encontrada', 404);
      }

      console.log(`🗑️ Usuario ${usuario_id} eliminó notificación ${id}`);

      return successResponse(
        res,
        { deleted: true },
        'Notificación eliminada correctamente',
        200
      );

    } catch (error) {
      console.error('❌ Error en eliminar:', error);
      return errorResponse(res, 'Error al eliminar notificación', 500);
    }
  },

  /**
   * ========================================
   * LIMPIAR NOTIFICACIONES ANTIGUAS
   * ========================================
   * DELETE /api/notificaciones/limpiar-antiguas
   * 
   * Elimina notificaciones con más de 30 días
   * Solo para administradores o tareas programadas
   */
  async limpiarAntiguas(req, res) {
    try {
      const totalEliminadas = await Notificacion.limpiarAntiguas();

      console.log(`🧹 Se eliminaron ${totalEliminadas} notificaciones antiguas`);

      return successResponse(
        res,
        { 
          eliminadas: totalEliminadas,
          mensaje: totalEliminadas === 0 
            ? 'No hay notificaciones antiguas para limpiar' 
            : `${totalEliminadas} notificaciones antiguas eliminadas`
        },
        'Limpieza completada',
        200
      );

    } catch (error) {
      console.error('❌ Error en limpiarAntiguas:', error);
      return errorResponse(res, 'Error al limpiar notificaciones antiguas', 500);
    }
  }
};

// ✅ CORREGIDO: Exportar con el nombre correcto
module.exports = NotificacionController;