const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');
const pool = require('../config/database');

/**
 * ============================================
 * CONTROLADOR DE SEGUIDORES
 * ============================================
 * Estructura de tabla:
 * - seguidor_id: quien sigue
 * - siguiendo_id: a quien sigue
 * - fecha_creacion: timestamp
 * ============================================
 */

const SeguidorController = {
  
  /**
   * ========================================
   * SEGUIR A UN USUARIO
   * ========================================
   * POST /api/seguidores/seguir
   * Body: { seguido_id: number }
   */
  async seguir(req, res) {
    try {
      const seguidor_id = req.usuario.id;
      const { seguido_id } = req.body;

      // Validaciones
      if (!seguido_id) {
        return errorResponse(res, 'El ID del usuario a seguir es requerido', 400);
      }

      // No puede seguirse a sí mismo
      if (seguidor_id === parseInt(seguido_id)) {
        return errorResponse(res, 'No puedes seguirte a ti mismo', 400);
      }

      // Verificar si el usuario a seguir existe
      const [usuario] = await pool.query(
        'SELECT id FROM usuarios WHERE id = ?',
        [seguido_id]
      );

      if (usuario.length === 0) {
        return errorResponse(res, 'El usuario a seguir no existe', 404);
      }

      // Verificar si ya lo sigue
      const [yaExiste] = await pool.query(
        'SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?',
        [seguidor_id, seguido_id]
      );

      if (yaExiste.length > 0) {
        return errorResponse(res, 'Ya sigues a este usuario', 400);
      }

      // Crear seguimiento
      await pool.query(
        'INSERT INTO seguidores (seguidor_id, siguiendo_id) VALUES (?, ?)',
        [seguidor_id, seguido_id]
      );

      // ✅ CREAR NOTIFICACIÓN DE SEGUIMIENTO
      await Notificacion.crearNotificacionSeguimiento(seguido_id, seguidor_id);

      console.log(`👥 Usuario ${seguidor_id} ahora sigue a ${seguido_id}`);

      return successResponse(
        res,
        { following: true },
        'Ahora sigues a este usuario',
        201
      );

    } catch (error) {
      console.error('❌ Error en seguir:', error);
      return errorResponse(res, 'Error al seguir usuario', 500);
    }
  },

  /**
   * ========================================
   * DEJAR DE SEGUIR A UN USUARIO
   * ========================================
   * DELETE /api/seguidores/dejar-de-seguir
   * Body: { seguido_id: number }
   */
  async dejarDeSeguir(req, res) {
    try {
      const seguidor_id = req.usuario.id;
      const { seguido_id } = req.body;

      // Validaciones
      if (!seguido_id) {
        return errorResponse(res, 'El ID del usuario es requerido', 400);
      }

      // Verificar si lo sigue
      const [existe] = await pool.query(
        'SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?',
        [seguidor_id, seguido_id]
      );

      if (existe.length === 0) {
        return errorResponse(res, 'No sigues a este usuario', 404);
      }

      // Eliminar seguimiento
      await pool.query(
        'DELETE FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?',
        [seguidor_id, seguido_id]
      );

      // ✅ ELIMINAR NOTIFICACIÓN DE SEGUIMIENTO
      await Notificacion.eliminarNotificacionSeguimiento(seguido_id, seguidor_id);

      console.log(`💔 Usuario ${seguidor_id} dejó de seguir a ${seguido_id}`);

      return successResponse(
        res,
        { following: false },
        'Dejaste de seguir a este usuario',
        200
      );

    } catch (error) {
      console.error('❌ Error en dejarDeSeguir:', error);
      return errorResponse(res, 'Error al dejar de seguir', 500);
    }
  },

  /**
   * ========================================
   * TOGGLE SEGUIR/DEJAR DE SEGUIR
   * ========================================
   * POST /api/seguidores/toggle
   * Body: { seguido_id: number }
   */
  async toggleSeguir(req, res) {
    try {
      const seguidor_id = req.usuario.id;
      const { seguido_id } = req.body;

      // Validaciones
      if (!seguido_id) {
        return errorResponse(res, 'El ID del usuario es requerido', 400);
      }

      if (seguidor_id === parseInt(seguido_id)) {
        return errorResponse(res, 'No puedes seguirte a ti mismo', 400);
      }

      // Verificar si el usuario existe
      const [usuario] = await pool.query(
        'SELECT id FROM usuarios WHERE id = ?',
        [seguido_id]
      );

      if (usuario.length === 0) {
        return errorResponse(res, 'El usuario no existe', 404);
      }

      // Verificar si ya lo sigue
      const [existe] = await pool.query(
        'SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?',
        [seguidor_id, seguido_id]
      );

      if (existe.length > 0) {
        // === DEJAR DE SEGUIR ===
        await pool.query(
          'DELETE FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?',
          [seguidor_id, seguido_id]
        );
        await Notificacion.eliminarNotificacionSeguimiento(seguido_id, seguidor_id);
        
        console.log(`💔 Usuario ${seguidor_id} dejó de seguir a ${seguido_id}`);
        
        return successResponse(
          res,
          { following: false },
          'Dejaste de seguir',
          200
        );
      } else {
        // === SEGUIR ===
        await pool.query(
          'INSERT INTO seguidores (seguidor_id, siguiendo_id) VALUES (?, ?)',
          [seguidor_id, seguido_id]
        );
        await Notificacion.crearNotificacionSeguimiento(seguido_id, seguidor_id);
        
        console.log(`👥 Usuario ${seguidor_id} ahora sigue a ${seguido_id}`);
        
        return successResponse(
          res,
          { following: true },
          'Ahora sigues a este usuario',
          201
        );
      }

    } catch (error) {
      console.error('❌ Error en toggleSeguir:', error);
      return errorResponse(res, 'Error al procesar seguimiento', 500);
    }
  },

  /**
   * ========================================
   * VERIFICAR SI SIGO A UN USUARIO
   * ========================================
   * GET /api/seguidores/verificar/:usuario_id
   */
  async verificarSiguiendo(req, res) {
    try {
      const seguidor_id = req.usuario.id;
      const { usuario_id } = req.params;

      const [existe] = await pool.query(
        'SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?',
        [seguidor_id, usuario_id]
      );

      return successResponse(
        res,
        { following: existe.length > 0 },
        'Verificación completada',
        200
      );

    } catch (error) {
      console.error('❌ Error en verificarSiguiendo:', error);
      return errorResponse(res, 'Error al verificar seguimiento', 500);
    }
  },

  /**
   * ========================================
   * OBTENER SEGUIDORES DE UN USUARIO
   * ========================================
   * GET /api/seguidores/seguidores/:usuario_id?limit=50&offset=0
   * 
   * Obtiene usuarios que SIGUEN a este usuario
   * (quienes tienen este usuario como siguiendo_id)
   */
  async obtenerSeguidores(req, res) {
    try {
      const { usuario_id } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      console.log(`📥 Obteniendo seguidores para usuario ${usuario_id}`);

      // ✅ CORREGIDO: siguiendo_id en WHERE (usuarios que siguen a este)
      const [seguidores] = await pool.query(
        `SELECT 
          u.id,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3,
          s.fecha_creacion as siguiendo_desde
        FROM seguidores s
        JOIN usuarios u ON s.seguidor_id = u.id
        WHERE s.siguiendo_id = ?
        ORDER BY s.fecha_creacion DESC
        LIMIT ? OFFSET ?`,
        [usuario_id, parseInt(limit), parseInt(offset)]
      );

      // Obtener total
      const [total] = await pool.query(
        'SELECT COUNT(*) as total FROM seguidores WHERE siguiendo_id = ?',
        [usuario_id]
      );

      console.log(`✅ Encontrados ${seguidores.length} seguidores de ${total[0].total} totales`);

      return successResponse(
        res,
        {
          seguidores,
          total: total[0].total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        },
        'Seguidores obtenidos correctamente',
        200
      );

    } catch (error) {
      console.error('❌ Error en obtenerSeguidores:', error);
      console.error('📋 SQL:', error.sql);
      return errorResponse(res, 'Error al obtener seguidores', 500);
    }
  },

  /**
   * ========================================
   * OBTENER SEGUIDOS DE UN USUARIO
   * ========================================
   * GET /api/seguidores/seguidos/:usuario_id?limit=50&offset=0
   * GET /api/seguidores/siguiendo/:usuario_id?limit=50&offset=0 (ALIAS)
   * 
   * Obtiene usuarios que este usuario SIGUE
   * (usuarios que están como siguiendo_id de este seguidor_id)
   */
  async obtenerSeguidos(req, res) {
    try {
      const { usuario_id } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      console.log(`📥 Obteniendo seguidos para usuario ${usuario_id}`);

      // ✅ CORREGIDO: seguidor_id en WHERE (usuarios que este sigue)
      const [seguidos] = await pool.query(
        `SELECT 
          u.id,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3,
          s.fecha_creacion as siguiendo_desde
        FROM seguidores s
        JOIN usuarios u ON s.siguiendo_id = u.id
        WHERE s.seguidor_id = ?
        ORDER BY s.fecha_creacion DESC
        LIMIT ? OFFSET ?`,
        [usuario_id, parseInt(limit), parseInt(offset)]
      );

      // Obtener total
      const [total] = await pool.query(
        'SELECT COUNT(*) as total FROM seguidores WHERE seguidor_id = ?',
        [usuario_id]
      );

      console.log(`✅ Encontrados ${seguidos.length} seguidos de ${total[0].total} totales`);

      return successResponse(
        res,
        {
          seguidos,
          total: total[0].total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        },
        'Seguidos obtenidos correctamente',
        200
      );

    } catch (error) {
      console.error('❌ Error en obtenerSeguidos:', error);
      console.error('📋 SQL:', error.sql);
      return errorResponse(res, 'Error al obtener seguidos', 500);
    }
  },

  /**
   * ========================================
   * OBTENER ESTADÍSTICAS DE UN USUARIO
   * ========================================
   * GET /api/seguidores/estadisticas/:usuario_id
   */
  async obtenerEstadisticas(req, res) {
    try {
      const { usuario_id } = req.params;

      // Contar seguidores (quienes lo siguen)
      const [seguidores] = await pool.query(
        'SELECT COUNT(*) as total FROM seguidores WHERE siguiendo_id = ?',
        [usuario_id]
      );

      // Contar seguidos (a quienes sigue)
      const [seguidos] = await pool.query(
        'SELECT COUNT(*) as total FROM seguidores WHERE seguidor_id = ?',
        [usuario_id]
      );

      return successResponse(
        res,
        {
          seguidores: seguidores[0].total,
          seguidos: seguidos[0].total
        },
        'Estadísticas obtenidas',
        200
      );

    } catch (error) {
      console.error('❌ Error en obtenerEstadisticas:', error);
      return errorResponse(res, 'Error al obtener estadísticas', 500);
    }
  }
};

module.exports = SeguidorController;