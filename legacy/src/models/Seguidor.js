// models/Seguidor.js
const db = require('../config/database');

class Seguidor {
  // ===========================
  //  SEGUIR A UN USUARIO
  // ===========================
  static async seguir(seguidor_id, siguiendo_id) {
    if (seguidor_id === siguiendo_id) {
      return { success: false, message: 'No puedes seguirte a ti mismo' };
    }

    // Verificar si ya lo sigue
    const [existe] = await db.execute(
      `SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?`,
      [seguidor_id, siguiendo_id]
    );

    if (existe.length > 0) {
      return { success: false, message: 'Ya sigues a este usuario' };
    }

    await db.execute(
      `INSERT INTO seguidores (seguidor_id, siguiendo_id) VALUES (?, ?)`,
      [seguidor_id, siguiendo_id]
    );

    return { success: true, message: 'Usuario seguido correctamente' };
  }

  // ===========================
  //  DEJAR DE SEGUIR
  // ===========================
  static async dejarDeSeguir(seguidor_id, siguiendo_id) {
    const [resultado] = await db.execute(
      `DELETE FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?`,
      [seguidor_id, siguiendo_id]
    );

    if (resultado.affectedRows === 0) {
      return { success: false, message: 'No estabas siguiendo a este usuario' };
    }

    return { success: true, message: 'Has dejado de seguir al usuario' };
  }

  // ===========================
  //  TOGGLE SEGUIR / DEJAR
  // ===========================
  static async toggle(seguidor_id, siguiendo_id) {
    const [existe] = await db.execute(
      `SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?`,
      [seguidor_id, siguiendo_id]
    );

    if (existe.length > 0) {
      await db.execute(
        `DELETE FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?`,
        [seguidor_id, siguiendo_id]
      );
      return { following: false, message: 'Has dejado de seguir al usuario' };
    } else {
      await db.execute(
        `INSERT INTO seguidores (seguidor_id, siguiendo_id) VALUES (?, ?)`,
        [seguidor_id, siguiendo_id]
      );
      return { following: true, message: 'Usuario seguido correctamente' };
    }
  }

  // ===========================
  //  VERIFICAR SI SIGUE A OTRO
  // ===========================
  static async verificar(seguidor_id, siguiendo_id) {
    const [rows] = await db.execute(
      `SELECT id FROM seguidores WHERE seguidor_id = ? AND siguiendo_id = ?`,
      [seguidor_id, siguiendo_id]
    );
    return rows.length > 0;
  }

  // ===========================
  //  OBTENER LISTA DE SEGUIDORES
  // ===========================
  static async obtenerSeguidores(usuario_id) {
    const query = `
      SELECT u.id, u.nombre_usuario, u.nombre_completo, u.foto_perfil_url
      FROM seguidores s
      JOIN usuarios u ON s.seguidor_id = u.id
      WHERE s.siguiendo_id = ?
      ORDER BY s.fecha_creacion DESC
    `;
    const [seguidores] = await db.execute(query, [usuario_id]);
    return seguidores;
  }

  // ===========================
  //  OBTENER LISTA DE SEGUIDOS
  // ===========================
  static async obtenerSeguidos(usuario_id) {
    const query = `
      SELECT u.id, u.nombre_usuario, u.nombre_completo, u.foto_perfil_url
      FROM seguidores s
      JOIN usuarios u ON s.siguiendo_id = u.id
      WHERE s.seguidor_id = ?
      ORDER BY s.fecha_creacion DESC
    `;
    const [seguidos] = await db.execute(query, [usuario_id]);
    return seguidos;
  }

  // ===========================
  //  CONTADORES RÁPIDOS
  // ===========================
  static async contarSeguidores(usuario_id) {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS total FROM seguidores WHERE siguiendo_id = ?`,
      [usuario_id]
    );
    return rows[0].total;
  }

  static async contarSeguidos(usuario_id) {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS total FROM seguidores WHERE seguidor_id = ?`,
      [usuario_id]
    );
    return rows[0].total;
  }
}

module.exports = Seguidor;
