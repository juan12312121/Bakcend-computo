const db = require('../config/database');

class Documento {
  static async crear(datos) {
    const query = `
      INSERT INTO documentos 
      (usuario_id, publicacion_id, documento_url, documento_s3, nombre_archivo, 
       tamano_archivo, tipo_archivo, icono, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [resultado] = await db.execute(query, [
      datos.usuario_id,
      datos.publicacion_id || null,
      datos.documento_url || null,
      datos.documento_s3 || null,
      datos.nombre_archivo,
      datos.tamano_archivo,
      datos.tipo_archivo,
      datos.icono || 'fa-file',
      datos.color || 'text-gray-500'
    ]);

    return resultado.insertId;
  }

  static async obtenerPorId(id) {
    const query = `
      SELECT d.*, u.nombre_usuario, u.nombre_completo
      FROM documentos d
      LEFT JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.id = ?
    `;
    const [filas] = await db.execute(query, [id]);
    return filas[0] || null;
  }

  static async obtenerPorUsuario(usuario_id) {
    const query = `
      SELECT * FROM documentos 
      WHERE usuario_id = ? 
      ORDER BY fecha_creacion DESC
    `;
    const [filas] = await db.execute(query, [usuario_id]);
    return filas;
  }

  /**
   * 🆕 Obtener documentos de una publicación específica
   */
  static async obtenerPorPublicacion(publicacion_id) {
    const query = `
      SELECT d.*, u.nombre_usuario, u.nombre_completo
      FROM documentos d
      LEFT JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.publicacion_id = ?
      ORDER BY d.fecha_creacion ASC
    `;
    const [filas] = await db.execute(query, [publicacion_id]);
    return filas;
  }

  /**
   * 🆕 Contar documentos de una publicación
   */
  static async contarPorPublicacion(publicacion_id) {
    const query = `
      SELECT COUNT(*) as total
      FROM documentos
      WHERE publicacion_id = ?
    `;
    const [filas] = await db.execute(query, [publicacion_id]);
    return filas[0].total;
  }

  static async obtenerTodos() {
    const query = `
      SELECT d.*, u.nombre_usuario, u.nombre_completo
      FROM documentos d
      LEFT JOIN usuarios u ON u.id = d.usuario_id
      ORDER BY d.fecha_creacion DESC
      LIMIT 100
    `;
    const [filas] = await db.execute(query);
    return filas;
  }

  static async actualizar(id, usuario_id, datos) {
    const campos = [];
    const valores = [];

    if (datos.nombre_archivo !== undefined) {
      campos.push('nombre_archivo = ?');
      valores.push(datos.nombre_archivo);
    }
    if (datos.documento_s3 !== undefined) {
      campos.push('documento_s3 = ?');
      valores.push(datos.documento_s3);
    }
    if (datos.publicacion_id !== undefined) {
      campos.push('publicacion_id = ?');
      valores.push(datos.publicacion_id);
    }
    if (datos.icono !== undefined) {
      campos.push('icono = ?');
      valores.push(datos.icono);
    }
    if (datos.color !== undefined) {
      campos.push('color = ?');
      valores.push(datos.color);
    }

    if (valores.length === 0) return false;

    valores.push(id, usuario_id);

    const query = `
      UPDATE documentos
      SET ${campos.join(', ')}
      WHERE id = ? AND usuario_id = ?
    `;

    const [resultado] = await db.execute(query, valores);
    return resultado.affectedRows > 0;
  }

  /**
   * 🆕 Desvincular documento de publicación (sin eliminarlo)
   */
  static async desvincularDePublicacion(id, usuario_id) {
    const query = `
      UPDATE documentos
      SET publicacion_id = NULL
      WHERE id = ? AND usuario_id = ?
    `;
    const [resultado] = await db.execute(query, [id, usuario_id]);
    return resultado.affectedRows > 0;
  }

  static async eliminar(id, usuario_id) {
    const query = `
      DELETE FROM documentos
      WHERE id = ? AND usuario_id = ?
    `;
    const [resultado] = await db.execute(query, [id, usuario_id]);
    return resultado.affectedRows > 0;
  }

  /**
   * 🆕 Eliminar todos los documentos de una publicación
   */
  static async eliminarPorPublicacion(publicacion_id, usuario_id) {
    const query = `
      DELETE FROM documentos
      WHERE publicacion_id = ? AND usuario_id = ?
    `;
    const [resultado] = await db.execute(query, [publicacion_id, usuario_id]);
    return resultado.affectedRows;
  }

  static obtenerIconoYColor(tipo_archivo) {
    const mapa = {
      'application/pdf': { icono: 'fa-file-pdf', color: 'text-red-500' },
      'application/msword': { icono: 'fa-file-word', color: 'text-blue-500' },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icono: 'fa-file-word', color: 'text-blue-500' },
      'application/vnd.ms-excel': { icono: 'fa-file-excel', color: 'text-green-500' },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icono: 'fa-file-excel', color: 'text-green-500' },
      'application/vnd.ms-powerpoint': { icono: 'fa-file-powerpoint', color: 'text-orange-500' },
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': { icono: 'fa-file-powerpoint', color: 'text-orange-500' },
      'application/zip': { icono: 'fa-file-archive', color: 'text-purple-500' },
      'application/x-rar-compressed': { icono: 'fa-file-archive', color: 'text-purple-500' },
      'text/csv': { icono: 'fa-file-csv', color: 'text-yellow-500' },
      'text/plain': { icono: 'fa-file-code', color: 'text-indigo-500' }
    };

    return mapa[tipo_archivo] || { icono: 'fa-file', color: 'text-gray-500' };
  }
}

module.exports = Documento;