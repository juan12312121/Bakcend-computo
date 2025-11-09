const db = require('../config/database');

class PublicacionNoInteresa {
  /**
   * Marcar una publicación como "No me interesa"
   * @param {number} usuarioId - ID del usuario
   * @param {number} publicacionId - ID de la publicación
   * @param {string} categoria - Categoría de la publicación (opcional)
   * @returns {Promise<number>} ID del registro creado
   */
  static async marcar(usuarioId, publicacionId, categoria = null) {
    try {
      // Verificar si ya existe
      const checkQuery = `
        SELECT id FROM publicaciones_no_interesa 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      const [existe] = await db.execute(checkQuery, [usuarioId, publicacionId]);
      
      if (existe.length > 0) {
        return existe[0].id;
      }

      // Si no se proporciona categoría, obtenerla de la publicación
      if (!categoria) {
        const categoriaQuery = `
          SELECT categoria FROM publicaciones WHERE id = ?
        `;
        const [pub] = await db.execute(categoriaQuery, [publicacionId]);
        categoria = pub[0]?.categoria || null;
      }

      // Insertar el registro
      const query = `
        INSERT INTO publicaciones_no_interesa (usuario_id, publicacion_id, categoria)
        VALUES (?, ?, ?)
      `;
      const [result] = await db.execute(query, [usuarioId, publicacionId, categoria]);
      return result.insertId;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Desmarcar "No me interesa" de una publicación
   * @param {number} usuarioId - ID del usuario
   * @param {number} publicacionId - ID de la publicación
   * @returns {Promise<boolean>}
   */
  static async desmarcar(usuarioId, publicacionId) {
    try {
      const query = `
        DELETE FROM publicaciones_no_interesa 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      await db.execute(query, [usuarioId, publicacionId]);
      return true;
    } catch (error) {
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
      throw error;
    }
  }

  /**
   * Obtener IDs de publicaciones marcadas como "No me interesa" por usuario
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<Array<number>>} Array de IDs de publicaciones
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
      throw error;
    }
  }

  /**
   * Obtener categorías que el usuario ha marcado frecuentemente como "No me interesa"
   * Solo devuelve categorías con 3 o más marcas
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<Array>} Array con categorías y estadísticas
   */
  static async obtenerCategoriasNoInteresan(usuarioId) {
    try {
      const query = `
        SELECT 
          categoria,
          COUNT(*) as total,
          (COUNT(*) * 100.0 / (
            SELECT COUNT(*) 
            FROM publicaciones_no_interesa 
            WHERE usuario_id = ?
          )) as porcentaje
        FROM publicaciones_no_interesa
        WHERE usuario_id = ? AND categoria IS NOT NULL
        GROUP BY categoria
        HAVING total >= 3
        ORDER BY total DESC
      `;
      const [result] = await db.execute(query, [usuarioId, usuarioId]);
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtener todas las publicaciones marcadas como "No me interesa" con información completa
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<Array>} Array de publicaciones
   */
  static async obtenerTodas(usuarioId) {
    try {
      const query = `
        SELECT 
          p.id,
          p.contenido,
          p.categoria,
          p.tipo_publicacion,
          p.fecha_creacion as fecha_publicacion,
          u.id as autor_id,
          u.nombre_completo,
          u.nombre_usuario,
          u.foto_perfil,
          pni.fecha_creacion as fecha_marcado,
          pni.categoria as categoria_guardada
        FROM publicaciones p
        INNER JOIN publicaciones_no_interesa pni ON p.id = pni.publicacion_id
        INNER JOIN usuarios u ON p.usuario_id = u.id
        WHERE pni.usuario_id = ?
        ORDER BY pni.fecha_creacion DESC
      `;
      const [publicaciones] = await db.execute(query, [usuarioId]);
      return publicaciones;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Contar total de publicaciones marcadas como "No me interesa" por usuario
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<number>} Total de publicaciones marcadas
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
      throw error;
    }
  }

  /**
   * Obtener estadísticas generales de "No me interesa" del usuario
   * @param {number} usuarioId - ID del usuario
   * @returns {Promise<Object>} Objeto con estadísticas
   */
  static async obtenerEstadisticas(usuarioId) {
    try {
      const query = `
        SELECT 
          COUNT(DISTINCT publicacion_id) as total_publicaciones,
          COUNT(DISTINCT categoria) as total_categorias,
          COUNT(DISTINCT DATE(fecha_creacion)) as dias_activos,
          MIN(fecha_creacion) as primera_marca,
          MAX(fecha_creacion) as ultima_marca
        FROM publicaciones_no_interesa
        WHERE usuario_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId]);
      return result[0] || {
        total_publicaciones: 0,
        total_categorias: 0,
        dias_activos: 0,
        primera_marca: null,
        ultima_marca: null
      };
    } catch (error) {
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
      const query = `
        DELETE FROM publicaciones_no_interesa 
        WHERE usuario_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId]);
      return result.affectedRows;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Limpiar marcas "No me interesa" de una categoría específica
   * @param {number} usuarioId - ID del usuario
   * @param {string} categoria - Categoría a limpiar
   * @returns {Promise<number>} Cantidad de registros eliminados
   */
  static async limpiarPorCategoria(usuarioId, categoria) {
    try {
      const query = `
        DELETE FROM publicaciones_no_interesa 
        WHERE usuario_id = ? AND categoria = ?
      `;
      const [result] = await db.execute(query, [usuarioId, categoria]);
      return result.affectedRows;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = PublicacionNoInteresa;