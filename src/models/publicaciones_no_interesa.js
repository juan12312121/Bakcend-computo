const db = require('../config/database');

class PublicacionNoInteresa {
  /**
   * Marcar una publicación como "No me interesa" (la oculta para el usuario)
   * @param {number} usuarioId - ID del usuario
   * @param {number} publicacionId - ID de la publicación
   * @returns {Promise<number>} ID del registro creado
   */
  static async marcar(usuarioId, publicacionId) {
    try {
      console.log('👎 Marcando publicación como "No me interesa":', { usuarioId, publicacionId });
      
      // Verificar si ya existe
      const checkQuery = `
        SELECT id FROM publicaciones_no_interesa 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      const [existe] = await db.execute(checkQuery, [usuarioId, publicacionId]);
      
      if (existe.length > 0) {
        console.log('ℹ️ Ya existe el registro:', existe[0].id);
        return existe[0].id;
      }

      // Insertar el registro (oculta la publicación para este usuario)
      const query = `
        INSERT INTO publicaciones_no_interesa (usuario_id, publicacion_id, fecha_creacion)
        VALUES (?, ?, NOW())
      `;
      const [result] = await db.execute(query, [usuarioId, publicacionId]);
      
      console.log('✅ Publicación marcada exitosamente. ID:', result.insertId);
      return result.insertId;
    } catch (error) {
      console.error('❌ Error al marcar "No me interesa":', error);
      throw error;
    }
  }

  /**
   * Desmarcar "No me interesa" (vuelve a mostrar la publicación)
   * @param {number} usuarioId - ID del usuario
   * @param {number} publicacionId - ID de la publicación
   * @returns {Promise<boolean>}
   */
  static async desmarcar(usuarioId, publicacionId) {
    try {
      console.log('👍 Desmarcando "No me interesa":', { usuarioId, publicacionId });
      
      const query = `
        DELETE FROM publicaciones_no_interesa 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId, publicacionId]);
      
      console.log('✅ Publicación desmarcada. Filas afectadas:', result.affectedRows);
      return true;
    } catch (error) {
      console.error('❌ Error al desmarcar:', error);
      throw error;
    }
  }

  /**
   * Verificar si una publicación está marcada como "No me interesa"
   * @param {number} usuarioId - ID del usuario
   * @param {number} publicacionId - ID de la publicación
   * @returns {Promise<boolean>}
   */
  static async verificar(usuarioId, publicacionId) {
    try {
      const query = `
        SELECT id FROM publicaciones_no_interesa 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId, publicacionId]);
      return result.length > 0;
    } catch (error) {
      console.error('❌ Error al verificar:', error);
      throw error;
    }
  }

  /**
   * Obtener IDs de publicaciones marcadas como "No me interesa" por usuario
   * Útil para filtrar el feed
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<Array<number>>} Array de IDs de publicaciones ocultas
   */
  static async obtenerIdsPorUsuario(usuarioId) {
    try {
      const query = `
        SELECT publicacion_id FROM publicaciones_no_interesa 
        WHERE usuario_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId]);
      return result.map(r => r.publicacion_id);
    } catch (error) {
      console.error('❌ Error al obtener IDs:', error);
      throw error;
    }
  }

  /**
   * Obtener todas las publicaciones marcadas como "No me interesa" con información completa
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<Array>} Array de publicaciones ocultas
   */
  static async obtenerTodas(usuarioId) {
    try {
      console.log('📊 Consultando publicaciones ocultas para usuario:', usuarioId);
      
      const query = `
        SELECT 
          p.id,
          p.contenido,
          p.categoria,
          p.fecha_creacion as fecha_publicacion,
          u.id as autor_id,
          u.nombre_completo,
          u.nombre_usuario,
          u.foto_perfil_s3 as foto_perfil,
          pni.fecha_creacion as fecha_ocultada
        FROM publicaciones p
        INNER JOIN publicaciones_no_interesa pni ON p.id = pni.publicacion_id
        LEFT JOIN usuarios u ON p.usuario_id = u.id
        WHERE pni.usuario_id = ?
        ORDER BY pni.fecha_creacion DESC
      `;
      const [publicaciones] = await db.execute(query, [usuarioId]);
      
      console.log('✅ Publicaciones ocultas obtenidas:', publicaciones.length);
      
      return publicaciones;
    } catch (error) {
      console.error('❌ Error en obtenerTodas:', error);
      throw error;
    }
  }

  /**
   * Contar total de publicaciones marcadas como "No me interesa" por usuario
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<number>} Total de publicaciones ocultas
   */
  static async contarPorUsuario(usuarioId) {
    try {
      const query = `
        SELECT COUNT(*) as total 
        FROM publicaciones_no_interesa 
        WHERE usuario_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId]);
      return result[0].total;
    } catch (error) {
      console.error('❌ Error al contar:', error);
      throw error;
    }
  }

  /**
   * Limpiar todas las marcas "No me interesa" de un usuario
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<number>} Cantidad de registros eliminados
   */
  static async limpiarTodas(usuarioId) {
    try {
      console.log('🗑️ Limpiando todas las marcas del usuario:', usuarioId);
      
      const query = `
        DELETE FROM publicaciones_no_interesa 
        WHERE usuario_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId]);
      
      console.log('✅ Marcas eliminadas:', result.affectedRows);
      return result.affectedRows;
    } catch (error) {
      console.error('❌ Error al limpiar:', error);
      throw error;
    }
  }
}

module.exports = PublicacionNoInteresa;