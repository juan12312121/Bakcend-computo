const pool = require('../config/database');

/**
 * MODELO LIKE
 * Maneja todas las operaciones de base de datos para likes
 */

class Like {
  /**
   * Crear un nuevo like
   */
  static async crear(publicacion_id, usuario_id) {
    try {
      const [result] = await pool.query(
        'INSERT INTO likes (publicacion_id, usuario_id) VALUES (?, ?)',
        [publicacion_id, usuario_id]
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Eliminar un like
   */
  static async eliminar(publicacion_id, usuario_id) {
    try {
      const [result] = await pool.query(
        'DELETE FROM likes WHERE publicacion_id = ? AND usuario_id = ?',
        [publicacion_id, usuario_id]
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Verificar si existe un like
   */
  static async existe(publicacion_id, usuario_id) {
    try {
      const [like] = await pool.query(
        'SELECT id FROM likes WHERE publicacion_id = ? AND usuario_id = ?',
        [publicacion_id, usuario_id]
      );
      return like.length > 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener todos los likes de una publicación
   */
  static async obtenerPorPublicacion(publicacion_id, limit = 50, offset = 0) {
    try {
      const [likes] = await pool.query(
        `SELECT 
          l.id,
          l.usuario_id,
          l.fecha_creacion,
          u.nombre_completo,
          u.nombre_usuario,
          u.foto_perfil_url,
          u.foto_perfil_s3
        FROM likes l
        JOIN usuarios u ON l.usuario_id = u.id
        WHERE l.publicacion_id = ?
        ORDER BY l.fecha_creacion DESC
        LIMIT ? OFFSET ?`,
        [publicacion_id, limit, offset]
      );
      return likes;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener total de likes de una publicación
   */
  static async obtenerTotal(publicacion_id) {
    try {
      const [result] = await pool.query(
        'SELECT COUNT(*) as total FROM likes WHERE publicacion_id = ?',
        [publicacion_id]
      );
      return result[0].total;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener todos los likes de un usuario
   */
  static async obtenerPorUsuario(usuario_id, limit = 50, offset = 0) {
    try {
      const [likes] = await pool.query(
        `SELECT 
          l.id,
          l.publicacion_id,
          l.fecha_creacion,
          p.contenido,
          p.total_likes,
          p.total_comentarios,
          p.total_compartidos
        FROM likes l
        JOIN publicaciones p ON l.publicacion_id = p.id
        WHERE l.usuario_id = ?
        ORDER BY l.fecha_creacion DESC
        LIMIT ? OFFSET ?`,
        [usuario_id, limit, offset]
      );
      return likes;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener total de likes del usuario
   */
  static async obtenerTotalPorUsuario(usuario_id) {
    try {
      const [result] = await pool.query(
        'SELECT COUNT(*) as total FROM likes WHERE usuario_id = ?',
        [usuario_id]
      );
      return result[0].total;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Incrementar total de likes en publicaciones
   */
  static async incrementarTotalPublicacion(publicacion_id) {
    try {
      const [result] = await pool.query(
        'UPDATE publicaciones SET total_likes = total_likes + 1 WHERE id = ?',
        [publicacion_id]
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Decrementar total de likes en publicaciones
   */
  static async decrementarTotalPublicacion(publicacion_id) {
    try {
      const [result] = await pool.query(
        'UPDATE publicaciones SET total_likes = GREATEST(total_likes - 1, 0) WHERE id = ?',
        [publicacion_id]
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Verificar que la publicación existe
   */
  static async publicacionExiste(publicacion_id) {
    try {
      const [publicacion] = await pool.query(
        'SELECT id FROM publicaciones WHERE id = ?',
        [publicacion_id]
      );
      return publicacion.length > 0;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Like;