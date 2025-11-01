const pool = require('../config/database');

const Comentario = {
  /**
   * Crear un nuevo comentario
   */
  async crear(publicacion_id, usuario_id, texto) {
    try {
      const query = `
        INSERT INTO comentarios (publicacion_id, usuario_id, texto, fecha_creacion)
        VALUES (?, ?, ?, NOW())
      `;
      
      const [result] = await pool.query(query, [publicacion_id, usuario_id, texto]);
      return result.insertId;
    } catch (error) {
      console.error('Error en Comentario.crear:', error);
      throw error;
    }
  },

  /**
   * Obtener comentarios de una publicación
   * ESTE ES EL QUE ESTABA CAUSANDO EL ERROR
   */
  async obtenerPorPublicacion(publicacion_id, limit = 50, offset = 0) {
    try {
      const query = `
        SELECT 
          c.id,
          c.publicacion_id,
          c.usuario_id,
          c.texto,
          c.fecha_creacion,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3
        FROM comentarios c
        INNER JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.publicacion_id = ?
        ORDER BY c.fecha_creacion DESC
        LIMIT ? OFFSET ?
      `;
      
      // ⚠️ IMPORTANTE: Los parámetros deben ser números, no strings
      const [rows] = await pool.query(query, [
        parseInt(publicacion_id),
        parseInt(limit),
        parseInt(offset)
      ]);
      
      return rows;
    } catch (error) {
      console.error('Error en Comentario.obtenerPorPublicacion:', error);
      throw error;
    }
  },

  /**
   * Contar comentarios de una publicación
   */
  async contarPorPublicacion(publicacion_id) {
    try {
      const query = `
        SELECT COUNT(*) as total
        FROM comentarios
        WHERE publicacion_id = ?
      `;
      
      const [rows] = await pool.query(query, [parseInt(publicacion_id)]);
      return rows[0].total;
    } catch (error) {
      console.error('Error en Comentario.contarPorPublicacion:', error);
      throw error;
    }
  },

  /**
   * Obtener comentarios de un usuario
   */
  async obtenerPorUsuario(usuario_id, limit = 50, offset = 0) {
    try {
      const query = `
        SELECT 
          c.id,
          c.publicacion_id,
          c.usuario_id,
          c.texto,
          c.fecha_creacion,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3
        FROM comentarios c
        INNER JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.usuario_id = ?
        ORDER BY c.fecha_creacion DESC
        LIMIT ? OFFSET ?
      `;
      
      const [rows] = await pool.query(query, [
        parseInt(usuario_id),
        parseInt(limit),
        parseInt(offset)
      ]);
      
      return rows;
    } catch (error) {
      console.error('Error en Comentario.obtenerPorUsuario:', error);
      throw error;
    }
  },

  /**
   * Obtener un comentario por ID
   */
  async obtenerPorId(id) {
    try {
      const query = `
        SELECT 
          c.id,
          c.publicacion_id,
          c.usuario_id,
          c.texto,
          c.fecha_creacion,
          u.nombre_usuario,
          u.nombre_completo,
          u.foto_perfil_url,
          u.foto_perfil_s3
        FROM comentarios c
        INNER JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.id = ?
      `;
      
      const [rows] = await pool.query(query, [parseInt(id)]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error en Comentario.obtenerPorId:', error);
      throw error;
    }
  },

  /**
   * Actualizar un comentario
   */
  async actualizar(id, texto) {
    try {
      const query = `
        UPDATE comentarios
        SET texto = ?
        WHERE id = ?
      `;
      
      const [result] = await pool.query(query, [texto, parseInt(id)]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error en Comentario.actualizar:', error);
      throw error;
    }
  },

  /**
   * Eliminar un comentario
   */
  async eliminar(id) {
    try {
      const query = `
        DELETE FROM comentarios
        WHERE id = ?
      `;
      
      const [result] = await pool.query(query, [parseInt(id)]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error en Comentario.eliminar:', error);
      throw error;
    }
  },

  /**
   * Verificar si un comentario pertenece a un usuario
   */
  async esDelUsuario(comentario_id, usuario_id) {
    try {
      const query = `
        SELECT id
        FROM comentarios
        WHERE id = ? AND usuario_id = ?
      `;
      
      const [rows] = await pool.query(query, [
        parseInt(comentario_id),
        parseInt(usuario_id)
      ]);
      
      return rows.length > 0;
    } catch (error) {
      console.error('Error en Comentario.esDelUsuario:', error);
      throw error;
    }
  }
};

module.exports = Comentario;