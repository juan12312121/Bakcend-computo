const db = require('../config/database');

class Usuario {
  
  // Crear nuevo usuario (solo campos esenciales)
  static async crear(datos) {
    const query = `
      INSERT INTO usuarios 
      (nombre_usuario, email, nombre_completo, contrasena)
      VALUES (?, ?, ?, ?)
    `;
    
    const [resultado] = await db.execute(query, [
      datos.nombre_usuario,
      datos.email,
      datos.nombre_completo,
      datos.contrasena
    ]);
    
    return resultado.insertId;
  }
  
  // Buscar usuario por ID
  static async buscarPorId(id) {
    const query = `
      SELECT 
        id, nombre_usuario, email, nombre_completo, biografia, ubicacion,
        carrera, foto_perfil_url, foto_portada_url, total_seguidores,
        total_siguiendo, total_posts, activo, fecha_creacion
      FROM usuarios 
      WHERE id = ? AND activo = 1
    `;
    
    const [usuarios] = await db.execute(query, [id]);
    return usuarios[0] || null;
  }
  
  // Buscar usuario por email
  static async buscarPorEmail(email) {
    const query = `
      SELECT * FROM usuarios WHERE email = ?
    `;
    
    const [usuarios] = await db.execute(query, [email]);
    return usuarios[0] || null;
  }
  
  // Buscar usuario por nombre de usuario
  static async buscarPorNombreUsuario(nombre_usuario) {
    const query = `
      SELECT * FROM usuarios WHERE nombre_usuario = ?
    `;
    
    const [usuarios] = await db.execute(query, [nombre_usuario]);
    return usuarios[0] || null;
  }
  
  // Actualizar perfil (para completar información después del registro)
  static async actualizar(id, datos) {
    const campos = [];
    const valores = [];
    
    if (datos.nombre_completo) {
      campos.push('nombre_completo = ?');
      valores.push(datos.nombre_completo);
    }
    if (datos.biografia !== undefined) {
      campos.push('biografia = ?');
      valores.push(datos.biografia);
    }
    if (datos.ubicacion !== undefined) {
      campos.push('ubicacion = ?');
      valores.push(datos.ubicacion);
    }
    if (datos.carrera !== undefined) {
      campos.push('carrera = ?');
      valores.push(datos.carrera);
    }
    if (datos.foto_perfil_url) {
      campos.push('foto_perfil_url = ?');
      valores.push(datos.foto_perfil_url);
      if (datos.foto_perfil_s3) {
        campos.push('foto_perfil_s3 = ?');
        valores.push(datos.foto_perfil_s3);
      }
    }
    if (datos.foto_portada_url) {
      campos.push('foto_portada_url = ?');
      valores.push(datos.foto_portada_url);
      if (datos.foto_portada_s3) {
        campos.push('foto_portada_s3 = ?');
        valores.push(datos.foto_portada_s3);
      }
    }
    
    if (campos.length === 0) {
      return false;
    }
    
    valores.push(id);
    
    const query = `
      UPDATE usuarios 
      SET ${campos.join(', ')}
      WHERE id = ?
    `;
    
    const [resultado] = await db.execute(query, valores);
    return resultado.affectedRows > 0;
  }
  
  // Actualizar contraseña
  static async actualizarContrasena(id, nuevaContrasena) {
    const query = `
      UPDATE usuarios 
      SET contrasena = ?
      WHERE id = ?
    `;
    
    const [resultado] = await db.execute(query, [nuevaContrasena, id]);
    return resultado.affectedRows > 0;
  }
  
  // Buscar usuarios (búsqueda)
  static async buscar(termino, limite = 10) {
    const query = `
      SELECT 
        id, nombre_usuario, nombre_completo, foto_perfil_url, carrera
      FROM usuarios 
      WHERE (nombre_usuario LIKE ? OR nombre_completo LIKE ?)
      AND activo = 1
      LIMIT ?
    `;
    
    const [usuarios] = await db.execute(query, [
      `%${termino}%`,
      `%${termino}%`,
      limite
    ]);
    
    return usuarios;
  }
  
  // Eliminar usuario (soft delete)
  static async eliminar(id) {
    const query = `
      UPDATE usuarios 
      SET activo = 0
      WHERE id = ?
    `;
    
    const [resultado] = await db.execute(query, [id]);
    return resultado.affectedRows > 0;
  }
}

module.exports = Usuario;