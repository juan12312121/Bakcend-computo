const db = require('../config/database');

class PublicacionOculta {
  static async ocultar(usuarioId, publicacionId) {
    try {
      const checkQuery = `
        SELECT id FROM publicaciones_ocultas 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      const [existe] = await db.execute(checkQuery, [usuarioId, publicacionId]);
      
      if (existe.length > 0) {
        return existe[0].id;
      }

      const query = `
        INSERT INTO publicaciones_ocultas (usuario_id, publicacion_id)
        VALUES (?, ?)
      `;
      const [result] = await db.execute(query, [usuarioId, publicacionId]);
      return result.insertId;
    } catch (error) {
      throw error;
    }
  }

  static async verificarOculta(usuarioId, publicacionId) {
    try {
      const query = `
        SELECT id FROM publicaciones_ocultas 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId, publicacionId]);
      return result.length > 0;
    } catch (error) {
      throw error;
    }
  }

  static async mostrar(usuarioId, publicacionId) {
    try {
      const query = `
        DELETE FROM publicaciones_ocultas 
        WHERE usuario_id = ? AND publicacion_id = ?
      `;
      await db.execute(query, [usuarioId, publicacionId]);
      return true;
    } catch (error) {
      throw error;
    }
  }

  static async obtenerOcultas(usuarioId) {
    try {
      const query = `
        SELECT p.* FROM publicaciones p
        INNER JOIN publicaciones_ocultas po ON p.id = po.publicacion_id
        WHERE po.usuario_id = ?
        ORDER BY po.fecha_creacion DESC
      `;
      const [publicaciones] = await db.execute(query, [usuarioId]);
      return publicaciones;
    } catch (error) {
      throw error;
    }
  }

  static async obtenerIdsPorUsuario(usuarioId) {
    try {
      const query = `
        SELECT publicacion_id FROM publicaciones_ocultas 
        WHERE usuario_id = ?
      `;
      const [result] = await db.execute(query, [usuarioId]);
      return result.map(r => r.publicacion_id);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = PublicacionOculta;