const pool = require('../config/database');

/**
 * ============================================
 * MODELO DE NOTIFICACIONES
 * ============================================
 * Maneja todas las operaciones de base de datos
 * para el sistema de notificaciones
 * 
 * Tipos de notificaciones:
 * - like: Alguien dio like a tu publicación
 * - comment: Alguien comentó tu publicación
 * - follow: Alguien te siguió
 * ============================================
 */

class Notificacion {
  /**
   * ========================================
   * CREAR NOTIFICACIÓN GENÉRICA
   * ========================================
   */
  static async crear(usuario_id, de_usuario_id, tipo, publicacion_id = null, mensaje = null) {
    try {
      const [result] = await pool.query(
        `INSERT INTO notificaciones 
        (usuario_id, de_usuario_id, tipo, publicacion_id, mensaje) 
        VALUES (?, ?, ?, ?, ?)`,
        [usuario_id, de_usuario_id, tipo, publicacion_id, mensaje]
      );
      return result.insertId;
    } catch (error) {
      console.error('❌ Error en Notificacion.crear:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * CREAR NOTIFICACIÓN DE LIKE
   * ========================================
   * Se llama cuando alguien da like a una publicación
   */
  static async crearNotificacionLike(publicacion_id, usuario_que_da_like) {
    try {
      // 1. Obtener el dueño de la publicación
      const [publicacion] = await pool.query(
        'SELECT usuario_id FROM publicaciones WHERE id = ?',
        [publicacion_id]
      );

      if (!publicacion.length) return null;

      const dueno_publicacion = publicacion[0].usuario_id;

      // 2. No crear notificación si el usuario le da like a su propia publicación
      if (dueno_publicacion === usuario_que_da_like) return null;

      // 3. Verificar si ya existe una notificación similar reciente (últimas 24 horas)
      const [existe] = await pool.query(
        `SELECT id FROM notificaciones 
        WHERE usuario_id = ? 
        AND de_usuario_id = ? 
        AND tipo = 'like' 
        AND publicacion_id = ?
        AND fecha_creacion > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [dueno_publicacion, usuario_que_da_like, publicacion_id]
      );

      if (existe.length > 0) return null; // Ya existe notificación reciente

      // 4. Obtener nombre del usuario que da like
      const [usuario] = await pool.query(
        'SELECT nombre_usuario FROM usuarios WHERE id = ?',
        [usuario_que_da_like]
      );

      const mensaje = `@${usuario[0].nombre_usuario} le dio like a tu publicación`;

      // 5. Crear la notificación
      return await this.crear(
        dueno_publicacion,
        usuario_que_da_like,
        'like',
        publicacion_id,
        mensaje
      );
    } catch (error) {
      console.error('❌ Error en crearNotificacionLike:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * CREAR NOTIFICACIÓN DE COMENTARIO
   * ========================================
   * Se llama cuando alguien comenta una publicación
   */
  static async crearNotificacionComentario(publicacion_id, usuario_que_comenta) {
    try {
      // 1. Obtener el dueño de la publicación
      const [publicacion] = await pool.query(
        'SELECT usuario_id FROM publicaciones WHERE id = ?',
        [publicacion_id]
      );

      if (!publicacion.length) return null;

      const dueno_publicacion = publicacion[0].usuario_id;

      // 2. No crear notificación si el usuario comenta su propia publicación
      if (dueno_publicacion === usuario_que_comenta) return null;

      // 3. Obtener nombre del usuario que comenta
      const [usuario] = await pool.query(
        'SELECT nombre_usuario FROM usuarios WHERE id = ?',
        [usuario_que_comenta]
      );

      const mensaje = `@${usuario[0].nombre_usuario} comentó tu publicación`;

      // 4. Crear la notificación (siempre crear, aunque haya múltiples comentarios)
      return await this.crear(
        dueno_publicacion,
        usuario_que_comenta,
        'comment',
        publicacion_id,
        mensaje
      );
    } catch (error) {
      console.error('❌ Error en crearNotificacionComentario:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * CREAR NOTIFICACIÓN DE SEGUIMIENTO
   * ========================================
   * Se llama cuando alguien sigue a otro usuario
   */
  static async crearNotificacionSeguimiento(usuario_seguido, usuario_que_sigue) {
    try {
      // 1. Verificar si ya existe una notificación similar reciente (últimas 24 horas)
      const [existe] = await pool.query(
        `SELECT id FROM notificaciones 
        WHERE usuario_id = ? 
        AND de_usuario_id = ? 
        AND tipo = 'follow'
        AND fecha_creacion > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [usuario_seguido, usuario_que_sigue]
      );

      if (existe.length > 0) return null; // Ya existe notificación reciente

      // 2. Obtener nombre del usuario que sigue
      const [usuario] = await pool.query(
        'SELECT nombre_usuario FROM usuarios WHERE id = ?',
        [usuario_que_sigue]
      );

      const mensaje = `@${usuario[0].nombre_usuario} comenzó a seguirte`;

      // 3. Crear la notificación
      return await this.crear(
        usuario_seguido,
        usuario_que_sigue,
        'follow',
        null,
        mensaje
      );
    } catch (error) {
      console.error('❌ Error en crearNotificacionSeguimiento:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * OBTENER NOTIFICACIONES POR USUARIO
   * ========================================
   * Obtiene todas las notificaciones de un usuario (paginadas)
   */
  static async obtenerPorUsuario(usuario_id, limit = 20, offset = 0) {
    try {
      const [notificaciones] = await pool.query(
        `SELECT 
          n.id,
          n.usuario_id,
          n.de_usuario_id,
          n.tipo,
          n.publicacion_id,
          n.mensaje,
          n.leida,
          n.fecha_creacion,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3
        FROM notificaciones n
        JOIN usuarios u ON n.de_usuario_id = u.id
        WHERE n.usuario_id = ?
        ORDER BY n.fecha_creacion DESC
        LIMIT ? OFFSET ?`,
        [usuario_id, parseInt(limit), parseInt(offset)]
      );
      return notificaciones;
    } catch (error) {
      console.error('❌ Error en obtenerPorUsuario:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * OBTENER NOTIFICACIONES NO LEÍDAS
   * ========================================
   */
  static async obtenerNoLeidas(usuario_id) {
    try {
      const [notificaciones] = await pool.query(
        `SELECT 
          n.id,
          n.usuario_id,
          n.de_usuario_id,
          n.tipo,
          n.publicacion_id,
          n.mensaje,
          n.leida,
          n.fecha_creacion,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3
        FROM notificaciones n
        JOIN usuarios u ON n.de_usuario_id = u.id
        WHERE n.usuario_id = ? AND n.leida = 0
        ORDER BY n.fecha_creacion DESC`,
        [usuario_id]
      );
      return notificaciones;
    } catch (error) {
      console.error('❌ Error en obtenerNoLeidas:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * CONTAR NOTIFICACIONES NO LEÍDAS
   * ========================================
   */
  static async contarNoLeidas(usuario_id) {
    try {
      const [result] = await pool.query(
        'SELECT COUNT(*) as total FROM notificaciones WHERE usuario_id = ? AND leida = 0',
        [usuario_id]
      );
      return result[0].total;
    } catch (error) {
      console.error('❌ Error en contarNoLeidas:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * MARCAR NOTIFICACIÓN COMO LEÍDA
   * ========================================
   */
  static async marcarComoLeida(notificacion_id, usuario_id) {
    try {
      const [result] = await pool.query(
        'UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?',
        [notificacion_id, usuario_id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error en marcarComoLeida:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * MARCAR TODAS LAS NOTIFICACIONES COMO LEÍDAS
   * ========================================
   */
  static async marcarTodasComoLeidas(usuario_id) {
    try {
      const [result] = await pool.query(
        'UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0',
        [usuario_id]
      );
      return result.affectedRows;
    } catch (error) {
      console.error('❌ Error en marcarTodasComoLeidas:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * ELIMINAR UNA NOTIFICACIÓN
   * ========================================
   */
  static async eliminar(notificacion_id, usuario_id) {
    try {
      const [result] = await pool.query(
        'DELETE FROM notificaciones WHERE id = ? AND usuario_id = ?',
        [notificacion_id, usuario_id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error en eliminar:', error);
      throw error;
    }
  }


   static async eliminarNotificacionesPublicacion(publicacion_id) {
    try {
      const [result] = await pool.query(
        `DELETE FROM notificaciones 
        WHERE publicacion_id = ? 
        AND tipo IN ('like', 'comment')`,
        [publicacion_id]
      );
      
      console.log(`🗑️ Eliminadas ${result.affectedRows} notificaciones de publicación ${publicacion_id}`);
      
      return result.affectedRows;
    } catch (error) {
      console.error('❌ Error en eliminarNotificacionesPublicacion:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * ELIMINAR NOTIFICACIÓN DE LIKE
   * ========================================
   * Se llama cuando se elimina un like
   */
  static async eliminarNotificacionLike(publicacion_id, usuario_que_dio_like) {
    try {
      const [result] = await pool.query(
        `DELETE FROM notificaciones 
        WHERE tipo = 'like' 
        AND publicacion_id = ? 
        AND de_usuario_id = ?`,
        [publicacion_id, usuario_que_dio_like]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error en eliminarNotificacionLike:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * ELIMINAR NOTIFICACIÓN DE SEGUIMIENTO
   * ========================================
   * Se llama cuando se deja de seguir a alguien
   */
  static async eliminarNotificacionSeguimiento(usuario_seguido, usuario_que_seguia) {
    try {
      const [result] = await pool.query(
        `DELETE FROM notificaciones 
        WHERE tipo = 'follow' 
        AND usuario_id = ? 
        AND de_usuario_id = ?`,
        [usuario_seguido, usuario_que_seguia]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error en eliminarNotificacionSeguimiento:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * LIMPIAR NOTIFICACIONES ANTIGUAS
   * ========================================
   * Elimina notificaciones con más de 30 días
   * Útil para mantenimiento de base de datos
   */
  static async limpiarAntiguas() {
    try {
      const [result] = await pool.query(
        `DELETE FROM notificaciones 
        WHERE fecha_creacion < DATE_SUB(NOW(), INTERVAL 30 DAY)`
      );
      return result.affectedRows;
    } catch (error) {
      console.error('❌ Error en limpiarAntiguas:', error);
      throw error;
    }
  }
}

module.exports = Notificacion;