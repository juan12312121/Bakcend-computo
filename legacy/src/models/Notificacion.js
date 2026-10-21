const pool = require('../config/database');

// 🆕 Importar la función de SSE (se configurará después)
let enviarEventoSSE = null;

/**
 * Configurar la función SSE (llamar desde el archivo principal)
 */
function configurarSSE(funcionSSE) {
  enviarEventoSSE = funcionSSE;
  console.log('✅ SSE configurado en el modelo de Notificaciones');
}

/**
 * ============================================
 * HELPERS INTERNOS PARA SSE
 * ============================================
 */

/**
 * Enviar notificación en tiempo real por SSE
 */
async function enviarNotificacionTiempoReal(notificacionId, usuarioId) {
  if (!enviarEventoSSE) {
    console.log('⚠️ SSE no está configurado');
    return;
  }

  try {
    // Obtener datos completos de la notificación
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
      WHERE n.id = ?`,
      [notificacionId]
    );

    if (notificaciones.length === 0) {
      console.log('❌ Notificación no encontrada:', notificacionId);
      return;
    }

    const notificacion = notificaciones[0];

    // 🔔 Enviar nueva notificación por SSE
    enviarEventoSSE(usuarioId, 'nueva_notificacion', notificacion);
    
    // 🔢 Actualizar contador
    await actualizarContadorTiempoReal(usuarioId);

    console.log(`✅ Notificación ${notificacionId} enviada por SSE a usuario ${usuarioId}`);
  } catch (error) {
    console.error('❌ Error al enviar notificación en tiempo real:', error);
  }
}

/**
 * Actualizar contador en tiempo real por SSE
 */
async function actualizarContadorTiempoReal(usuarioId) {
  if (!enviarEventoSSE) {
    return;
  }

  try {
    const [result] = await pool.query(
      'SELECT COUNT(*) as total FROM notificaciones WHERE usuario_id = ? AND leida = 0',
      [usuarioId]
    );
    
    const total = result[0].total;
    
    // 🔢 Enviar contador actualizado por SSE
    enviarEventoSSE(usuarioId, 'actualizar_contador', { total });
    
    return total;
  } catch (error) {
    console.error('❌ Error al actualizar contador en tiempo real:', error);
    return 0;
  }
}

/**
 * ============================================
 * MODELO DE NOTIFICACIONES
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
      
      const notificacionId = result.insertId;
      
      // 🆕 Enviar por SSE en tiempo real
      await enviarNotificacionTiempoReal(notificacionId, usuario_id);
      
      return notificacionId;
    } catch (error) {
      console.error('❌ Error en Notificacion.crear:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * CREAR NOTIFICACIÓN DE LIKE
   * ========================================
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

      if (existe.length > 0) return null;

      // 4. Obtener nombre del usuario que da like
      const [usuario] = await pool.query(
        'SELECT nombre_usuario FROM usuarios WHERE id = ?',
        [usuario_que_da_like]
      );

      const mensaje = `le gustó tu publicación`;

      // 5. Crear la notificación (se enviará automáticamente por SSE)
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
   */
  static async crearNotificacionComentario(publicacion_id, usuario_que_comenta) {
    try {
      const [publicacion] = await pool.query(
        'SELECT usuario_id FROM publicaciones WHERE id = ?',
        [publicacion_id]
      );

      if (!publicacion.length) return null;

      const dueno_publicacion = publicacion[0].usuario_id;

      if (dueno_publicacion === usuario_que_comenta) return null;

      const [usuario] = await pool.query(
        'SELECT nombre_usuario FROM usuarios WHERE id = ?',
        [usuario_que_comenta]
      );

      const mensaje = `comentó tu publicación`;

      // Crear la notificación (se enviará automáticamente por SSE)
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
   */
  static async crearNotificacionSeguimiento(usuario_seguido, usuario_que_sigue) {
    try {
      const [existe] = await pool.query(
        `SELECT id FROM notificaciones 
        WHERE usuario_id = ? 
        AND de_usuario_id = ? 
        AND tipo = 'follow'
        AND fecha_creacion > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [usuario_seguido, usuario_que_sigue]
      );

      if (existe.length > 0) return null;

      const [usuario] = await pool.query(
        'SELECT nombre_usuario FROM usuarios WHERE id = ?',
        [usuario_que_sigue]
      );

      const mensaje = `comenzó a seguirte`;

      // Crear la notificación (se enviará automáticamente por SSE)
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
      
      // 🆕 Actualizar contador en tiempo real
      if (result.affectedRows > 0) {
        await actualizarContadorTiempoReal(usuario_id);
      }
      
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
      
      // 🆕 Actualizar contador en tiempo real (será 0)
      if (result.affectedRows > 0) {
        await actualizarContadorTiempoReal(usuario_id);
      }
      
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
      
      // 🆕 Actualizar contador en tiempo real
      if (result.affectedRows > 0) {
        await actualizarContadorTiempoReal(usuario_id);
      }
      
      return result.affectedRows > 0;
    } catch (error) {
      console.error('❌ Error en eliminar:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * ELIMINAR NOTIFICACIONES DE PUBLICACIÓN
   * ========================================
   */
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
   */
  static async eliminarNotificacionLike(publicacion_id, usuario_que_dio_like) {
    try {
      // Obtener el usuario_id afectado antes de eliminar
      const [notif] = await pool.query(
        `SELECT usuario_id FROM notificaciones 
        WHERE tipo = 'like' 
        AND publicacion_id = ? 
        AND de_usuario_id = ?`,
        [publicacion_id, usuario_que_dio_like]
      );

      const [result] = await pool.query(
        `DELETE FROM notificaciones 
        WHERE tipo = 'like' 
        AND publicacion_id = ? 
        AND de_usuario_id = ?`,
        [publicacion_id, usuario_que_dio_like]
      );
      
      // 🆕 Actualizar contador en tiempo real
      if (result.affectedRows > 0 && notif.length > 0) {
        await actualizarContadorTiempoReal(notif[0].usuario_id);
      }
      
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
      
      // 🆕 Actualizar contador en tiempo real
      if (result.affectedRows > 0) {
        await actualizarContadorTiempoReal(usuario_seguido);
      }
      
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
module.exports.configurarSSE = configurarSSE;