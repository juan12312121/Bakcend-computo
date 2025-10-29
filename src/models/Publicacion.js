const db = require('../config/database');

class Publicacion {
    
  static async crear(datos) {
    const query = `
      INSERT INTO publicaciones 
      (usuario_id, contenido, imagen_url, imagen_s3, categoria, color_categoria)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const [resultado] = await db.execute(query, [
      datos.usuario_id,
      datos.contenido,
      datos.imagen_url || null,
      datos.imagen_s3 || null,
      datos.categoria || 'General',
      datos.color_categoria || 'bg-gray-500'
    ]);

    return resultado.insertId;
  }

  // ✅ CORREGIDO: Cambié "usuario usuarios" por "usuarios U"
  static async obtenerTodas() {
    const query = `
      SELECT P.*, U.nombre_completo, U.nombre_usuario, U.foto_perfil_url
      FROM publicaciones P
      INNER JOIN usuarios U ON U.id = P.usuario_id
      WHERE P.oculto = 0
      ORDER BY P.fecha_creacion DESC
    `;
    const [filas] = await db.execute(query);
    return filas;
  }

  static async obtenerPorId(id) {
    const query = `
      SELECT P.*, U.nombre_usuario, U.nombre_completo, U.foto_perfil_url
      FROM publicaciones P
      INNER JOIN usuarios U ON U.id = P.usuario_id
      WHERE P.id = ?
    `;
    const [filas] = await db.execute(query, [id]);
    return filas[0] || null;
  }

  // ✅ CORREGIDO: Faltaba construir el array de campos
  static async actualizar(id, usuarioId, datos) {
    const campos = [];
    const valores = [];

    if (datos.contenido !== undefined) {
      campos.push('contenido = ?');
      valores.push(datos.contenido);
    }
    if (datos.imagen_url !== undefined) {
      campos.push('imagen_url = ?');
      valores.push(datos.imagen_url);
    }
    if (datos.imagen_s3 !== undefined) {
      campos.push('imagen_s3 = ?');
      valores.push(datos.imagen_s3);
    }
    if (datos.categoria !== undefined) {
      campos.push('categoria = ?');
      valores.push(datos.categoria);
    }
    if (datos.color_categoria !== undefined) {
      campos.push('color_categoria = ?');
      valores.push(datos.color_categoria);
    }

    if (valores.length === 0) return false;

    valores.push(id, usuarioId);

    const query = `
      UPDATE publicaciones
      SET ${campos.join(', ')}
      WHERE id = ? AND usuario_id = ?
    `;

    const [resultado] = await db.execute(query, valores);
    return resultado.affectedRows > 0;
  }

  static async eliminar(id, usuarioId) {
    const query = `
      UPDATE publicaciones
      SET oculto = 1
      WHERE id = ? AND usuario_id = ?
    `;
    const [resultado] = await db.execute(query, [id, usuarioId]);
    return resultado.affectedRows > 0;
  }

  static async obtenerAleatorias(limit = 10) {
    const query = `
      SELECT P.*, U.nombre_completo, U.nombre_usuario, U.foto_perfil_url
      FROM publicaciones P
      INNER JOIN usuarios U ON U.id = P.usuario_id
      WHERE P.oculto = 0
      ORDER BY RAND()
      LIMIT ?
    `;
    const [filas] = await db.execute(query, [limit]);
    return filas;
  }

  // ✅ MEJORADO: Ahora maneja el error de columna seguido_id si no existe la tabla
  static async obtenerTodasParaUsuario(usuarioId) {
    try {
      const query = `
        SELECT P.*, U.nombre_completo, U.nombre_usuario, U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0
          AND (P.usuario_id IN (
            SELECT seguido_id 
            FROM seguidores 
            WHERE seguidor_id = ?
          ) OR P.usuario_id = ?)
        ORDER BY P.fecha_creacion DESC
      `;
      const [filas] = await db.execute(query, [usuarioId, usuarioId]);
      return filas;
    } catch (error) {
      // Si falla (tabla seguidores no existe o columna incorrecta), solo retornar las del usuario
      console.warn('⚠️ Tabla seguidores no disponible, mostrando solo publicaciones propias');
      return await this.obtenerPorUsuario(usuarioId);
    }
  }

  // Obtener publicaciones de un usuario específico
  static async obtenerPorUsuario(usuarioId) {
    const query = `
      SELECT P.*, U.nombre_completo, U.nombre_usuario, U.foto_perfil_url
      FROM publicaciones P
      INNER JOIN usuarios U ON U.id = P.usuario_id
      WHERE P.oculto = 0 AND P.usuario_id = ?
      ORDER BY P.fecha_creacion DESC
    `;
    const [filas] = await db.execute(query, [usuarioId]);
    return filas;
  }
}

module.exports = Publicacion;