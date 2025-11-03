const pool = require('../config/database');

const SeccionModel = {
  
  // Crear una nueva sección
  crear: async (usuario_id, nombre, icono = 'fa-folder', color = 'from-gray-400 to-gray-600') => {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.query(
        `INSERT INTO secciones (usuario_id, nombre, icono, color) 
         VALUES (?, ?, ?, ?)`,
        [usuario_id, nombre, icono, color]
      );
      return result.insertId;
    } finally {
      connection.release();
    }
  },

  // Buscar sección por ID
  buscarPorId: async (id) => {
    const connection = await pool.getConnection();
    try {
      const [secciones] = await connection.query(
        'SELECT * FROM secciones WHERE id = ?',
        [id]
      );
      return secciones[0] || null;
    } finally {
      connection.release();
    }
  },

  // Buscar sección por ID y usuario
  buscarPorIdYUsuario: async (id, usuario_id) => {
    const connection = await pool.getConnection();
    try {
      const [secciones] = await connection.query(
        'SELECT * FROM secciones WHERE id = ? AND usuario_id = ?',
        [id, usuario_id]
      );
      return secciones[0] || null;
    } finally {
      connection.release();
    }
  },

  // Buscar sección por nombre y usuario
  buscarPorNombreYUsuario: async (nombre, usuario_id) => {
    const connection = await pool.getConnection();
    try {
      const [secciones] = await connection.query(
        'SELECT * FROM secciones WHERE nombre = ? AND usuario_id = ?',
        [nombre, usuario_id]
      );
      return secciones[0] || null;
    } finally {
      connection.release();
    }
  },

  // Buscar sección por nombre excluyendo un ID
  buscarPorNombreExcluyendoId: async (nombre, usuario_id, excluir_id) => {
    const connection = await pool.getConnection();
    try {
      const [secciones] = await connection.query(
        'SELECT * FROM secciones WHERE nombre = ? AND usuario_id = ? AND id != ?',
        [nombre, usuario_id, excluir_id]
      );
      return secciones[0] || null;
    } finally {
      connection.release();
    }
  },

  // Obtener todas las secciones de un usuario
  obtenerPorUsuario: async (usuario_id) => {
    const connection = await pool.getConnection();
    try {
      const [secciones] = await connection.query(
        `SELECT * FROM secciones 
         WHERE usuario_id = ? 
         ORDER BY fecha_creacion DESC`,
        [usuario_id]
      );
      return secciones;
    } finally {
      connection.release();
    }
  },

  // Obtener posts de una sección
  obtenerPostsDeSeccion: async (seccion_id, usuario_id) => {
    const connection = await pool.getConnection();
    try {
      const [posts] = await connection.query(
        `SELECT p.* 
         FROM publicaciones p
         INNER JOIN publicaciones_secciones ps ON p.id = ps.publicacion_id
         WHERE ps.seccion_id = ? AND p.usuario_id = ?
         ORDER BY p.fecha_creacion DESC`,
        [seccion_id, usuario_id]
      );
      return posts;
    } finally {
      connection.release();
    }
  },

  // Actualizar sección
  actualizar: async (id, datos) => {
    const connection = await pool.getConnection();
    try {
      const updates = [];
      const values = [];

      if (datos.nombre !== undefined) {
        updates.push('nombre = ?');
        values.push(datos.nombre);
      }
      if (datos.icono !== undefined) {
        updates.push('icono = ?');
        values.push(datos.icono);
      }
      if (datos.color !== undefined) {
        updates.push('color = ?');
        values.push(datos.color);
      }

      if (updates.length === 0) {
        return false;
      }

      values.push(id);

      const [result] = await connection.query(
        `UPDATE secciones SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      return result.affectedRows > 0;
    } finally {
      connection.release();
    }
  },

  // Eliminar sección (con transacción)
  eliminar: async (id, usuario_id) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Eliminar relaciones con publicaciones
      await connection.query(
        'DELETE FROM publicaciones_secciones WHERE seccion_id = ?',
        [id]
      );

      // Eliminar la sección
      const [result] = await connection.query(
        'DELETE FROM secciones WHERE id = ? AND usuario_id = ?',
        [id, usuario_id]
      );

      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Verificar si un post ya está en una sección
  existeRelacionPostSeccion: async (seccion_id, publicacion_id) => {
    const connection = await pool.getConnection();
    try {
      const [relaciones] = await connection.query(
        'SELECT id FROM publicaciones_secciones WHERE seccion_id = ? AND publicacion_id = ?',
        [seccion_id, publicacion_id]
      );
      return relaciones.length > 0;
    } finally {
      connection.release();
    }
  },

  // Agregar post a sección (con transacción)
  agregarPost: async (seccion_id, publicacion_id) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Insertar relación
      await connection.query(
        'INSERT INTO publicaciones_secciones (seccion_id, publicacion_id) VALUES (?, ?)',
        [seccion_id, publicacion_id]
      );

      // Actualizar contador
      await connection.query(
        `UPDATE secciones 
         SET total_posts = (
           SELECT COUNT(*) FROM publicaciones_secciones WHERE seccion_id = ?
         ) 
         WHERE id = ?`,
        [seccion_id, seccion_id]
      );

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Quitar post de sección (con transacción)
  quitarPost: async (seccion_id, publicacion_id) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Eliminar relación
      const [result] = await connection.query(
        'DELETE FROM publicaciones_secciones WHERE seccion_id = ? AND publicacion_id = ?',
        [seccion_id, publicacion_id]
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return false;
      }

      // Actualizar contador
      await connection.query(
        `UPDATE secciones 
         SET total_posts = (
           SELECT COUNT(*) FROM publicaciones_secciones WHERE seccion_id = ?
         ) 
         WHERE id = ?`,
        [seccion_id, seccion_id]
      );

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Obtener secciones de un post
  obtenerSeccionesDePost: async (publicacion_id) => {
    const connection = await pool.getConnection();
    try {
      const [secciones] = await connection.query(
        `SELECT s.* 
         FROM secciones s
         INNER JOIN publicaciones_secciones ps ON s.id = ps.seccion_id
         WHERE ps.publicacion_id = ?
         ORDER BY s.nombre ASC`,
        [publicacion_id]
      );
      return secciones;
    } finally {
      connection.release();
    }
  }

};

module.exports = SeccionModel;