const db = require('../config/database');
const Publicacion = require('./Publicacion');
const Usuario = require('./Usuario');

class Reporte {
  static async crear(publicacionId, usuarioId, motivo, descripcion) {
    try {
      // Validar que no exista un reporte previo del mismo usuario en la misma publicación
      const checkQuery = `
        SELECT id FROM reportes 
        WHERE publicacion_id = ? AND usuario_id = ?
      `;
      const [existe] = await db.execute(checkQuery, [publicacionId, usuarioId]);
      
      if (existe.length > 0) {
        throw new Error('Ya has reportado esta publicación');
      }

      const query = `
        INSERT INTO reportes (publicacion_id, usuario_id, motivo, descripcion)
        VALUES (?, ?, ?, ?)
      `;
      const [result] = await db.execute(query, [publicacionId, usuarioId, motivo, descripcion]);
      
      // Contar reportes de la publicación
      const totalReportes = await this.contarReportesActivos(publicacionId);
      
      // Si hay 5 o más reportes, eliminar la publicación
      if (totalReportes >= 5) {
        await this.procesarPublicacionConMuchosReportes(publicacionId);
      }
      
      return result.insertId;
    } catch (error) {
      throw error;
    }
  }

  static async procesarPublicacionConMuchosReportes(publicacionId) {
    try {
      // Obtener el usuario dueño de la publicación
      const queryOwner = `SELECT usuario_id FROM publicaciones WHERE id = ?`;
      const [owner] = await db.execute(queryOwner, [publicacionId]);
      
      if (owner.length === 0) return;
      
      const usuarioId = owner[0].usuario_id;
      
      // Eliminar la publicación
      await Publicacion.eliminar(publicacionId, usuarioId);
      console.log(`📛 Publicación ${publicacionId} eliminada por exceso de reportes (Usuario ${usuarioId})`);
      
      // Contar cuántas publicaciones DEL DUEÑO han sido eliminadas por tener 5+ reportes
      const queryPublicacionesEliminadas = `
        SELECT COUNT(p.id) as total
        FROM publicaciones p
        WHERE p.usuario_id = ? AND p.oculto = 1
        AND p.id IN (
          SELECT publicacion_id FROM reportes GROUP BY publicacion_id HAVING COUNT(*) >= 5
        )
      `;
      const [result] = await db.execute(queryPublicacionesEliminadas, [usuarioId]);
      
      const publicacionesEliminadas = result[0].total || 0;
      console.log(`⚠️ Usuario ${usuarioId} tiene ${publicacionesEliminadas} publicaciones eliminadas por reportes`);
      
      // Si 3 o más publicaciones del usuario fueron eliminadas por 5+ reportes, suspender
      if (publicacionesEliminadas >= 3) {
        await this.suspenderUsuario(usuarioId);
      }
    } catch (error) {
      console.error('Error procesando publicación con muchos reportes:', error);
      throw error;
    }
  }

  static async suspenderUsuario(usuarioId) {
    try {
      const Usuario = require('./Usuario');
      
      // Suspender el usuario
      await Usuario.suspender(usuarioId);
      console.log(`🔒 Usuario ${usuarioId} ha sido suspendido por exceso de reportes`);
      
      return true;
    } catch (error) {
      console.error('Error suspendiendo usuario:', error);
      throw error;
    }
  }

  static async obtenerPorPublicacion(publicacionId) {
    try {
      const query = `
        SELECT r.id, r.publicacion_id, r.usuario_id, r.motivo, r.descripcion, r.fecha_reporte,
               u.nombre_completo, u.nombre_usuario
        FROM reportes r
        JOIN usuarios u ON r.usuario_id = u.id
        WHERE r.publicacion_id = ?
        ORDER BY r.fecha_reporte DESC
      `;
      const [reportes] = await db.execute(query, [publicacionId]);
      return reportes;
    } catch (error) {
      throw error;
    }
  }

  static async contarReportesActivos(publicacionId) {
    try {
      const query = `
        SELECT COUNT(*) as total FROM reportes WHERE publicacion_id = ?
      `;
      const [result] = await db.execute(query, [publicacionId]);
      return result[0].total;
    } catch (error) {
      throw error;
    }
  }

  static async obtenerTodos() {
    try {
      const query = `
        SELECT 
          p.id,
          p.contenido,
          p.categoria,
          p.oculto,
          u.nombre_completo,
          u.nombre_usuario,
          COUNT(r.id) as total_reportes,
          GROUP_CONCAT(DISTINCT r.motivo SEPARATOR ', ') as motivos
        FROM publicaciones p
        LEFT JOIN reportes r ON p.id = r.publicacion_id
        LEFT JOIN usuarios u ON p.usuario_id = u.id
        WHERE r.id IS NOT NULL
        GROUP BY p.id
        ORDER BY total_reportes DESC, p.fecha_creacion DESC
      `;
      const [reportes] = await db.execute(query);
      return reportes;
    } catch (error) {
      throw error;
    }
  }

  static async obtenerEstadisticasUsuarios() {
    try {
      const query = `
        SELECT 
          u.id,
          u.nombre_completo,
          u.nombre_usuario,
          u.suspendido,
          COUNT(DISTINCT CASE WHEN p.oculto = 1 THEN p.id END) as publicaciones_eliminadas,
          COUNT(DISTINCT p.id) as total_publicaciones_reportadas,
          COUNT(r.id) as total_reportes_recibidos
        FROM usuarios u
        LEFT JOIN publicaciones p ON u.id = p.usuario_id
        LEFT JOIN reportes r ON p.id = r.publicacion_id
        WHERE COUNT(r.id) > 0 OR u.suspendido = 1
        GROUP BY u.id
        HAVING total_reportes_recibidos > 0 OR u.suspendido = 1
        ORDER BY publicaciones_eliminadas DESC, total_reportes_recibidos DESC
      `;
      const [stats] = await db.execute(query);
      return stats;
    } catch (error) {
      throw error;
    }
  }

  static async eliminar(reporteId) {
    try {
      const query = `DELETE FROM reportes WHERE id = ?`;
      await db.execute(query, [reporteId]);
      return true;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Reporte;
