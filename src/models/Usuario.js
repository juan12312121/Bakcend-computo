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
    try {
      const query = `
        SELECT 
          id, nombre_usuario, email, nombre_completo, biografia, ubicacion,
          carrera, foto_perfil_url, foto_portada_url, total_seguidores,
          total_siguiendo, total_posts, activo, suspendido, fecha_creacion
        FROM usuarios 
        WHERE id = ? AND activo = 1
      `;
      
      const [usuarios] = await db.execute(query, [id]);
      
      if (!usuarios || usuarios.length === 0) {
        return null;
      }
      
      return usuarios[0];
      
    } catch (error) {
      console.error('❌ Error en buscarPorId:', error);
      throw error;
    }
  }
  
  // Buscar usuario por email
  static async buscarPorEmail(email) {
    try {
      const query = `
        SELECT * FROM usuarios WHERE email = ?
      `;
      
      const [usuarios] = await db.execute(query, [email]);
      return usuarios[0] || null;
      
    } catch (error) {
      console.error('❌ Error en buscarPorEmail:', error);
      throw error;
    }
  }
  
  // Buscar usuario por nombre de usuario
  static async buscarPorNombreUsuario(nombre_usuario) {
    try {
      const query = `
        SELECT * FROM usuarios WHERE nombre_usuario = ?
      `;
      
      const [usuarios] = await db.execute(query, [nombre_usuario]);
      return usuarios[0] || null;
      
    } catch (error) {
      console.error('❌ Error en buscarPorNombreUsuario:', error);
      throw error;
    }
  }
  
  // Actualizar perfil (para completar información después del registro)
  static async actualizar(id, datos) {
    try {
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
      
    } catch (error) {
      console.error('❌ Error en actualizar:', error);
      throw error;
    }
  }
  
  // Actualizar contraseña
  static async actualizarContrasena(id, nuevaContrasena) {
    try {
      const query = `
        UPDATE usuarios 
        SET contrasena = ?
        WHERE id = ?
      `;
      
      const [resultado] = await db.execute(query, [nuevaContrasena, id]);
      return resultado.affectedRows > 0;
      
    } catch (error) {
      console.error('❌ Error en actualizarContrasena:', error);
      throw error;
    }
  }
  
  // 🔒 SUSPENDER USUARIO (por exceso de reportes)
  static async suspender(id) {
    try {
      const query = `
        UPDATE usuarios 
        SET suspendido = 1
        WHERE id = ?
      `;
      
      const [resultado] = await db.execute(query, [id]);
      console.log(`🔒 Usuario ${id} suspendido`);
      return resultado.affectedRows > 0;
      
    } catch (error) {
      console.error('❌ Error en suspender:', error);
      throw error;
    }
  }

  // 🔓 LEVANTAR SUSPENSIÓN (por moderador)
  static async levantarSuspension(id) {
    try {
      const query = `
        UPDATE usuarios 
        SET suspendido = 0
        WHERE id = ?
      `;
      
      const [resultado] = await db.execute(query, [id]);
      console.log(`✅ Suspensión levantada para usuario ${id}`);
      return resultado.affectedRows > 0;
      
    } catch (error) {
      console.error('❌ Error en levantarSuspension:', error);
      throw error;
    }
  }

  // Verificar si usuario está suspendido
  static async estaSuspendido(id) {
    try {
      const query = `
        SELECT suspendido FROM usuarios WHERE id = ?
      `;
      
      const [resultado] = await db.execute(query, [id]);
      
      if (resultado.length === 0) {
        return false;
      }
      
      return resultado[0].suspendido === 1;
      
    } catch (error) {
      console.error('❌ Error en estaSuspendido:', error);
      return false;
    }
  }

  // Obtener usuarios suspendidos
  static async obtenerSuspendidos() {
    try {
      const query = `
        SELECT 
          id, nombre_usuario, nombre_completo, email, 
          suspendido, fecha_creacion
        FROM usuarios 
        WHERE suspendido = 1
        ORDER BY fecha_creacion DESC
      `;
      
      const [usuarios] = await db.execute(query);
      return usuarios;
      
    } catch (error) {
      console.error('❌ Error en obtenerSuspendidos:', error);
      throw error;
    }
  }
  
  // Buscar usuarios (búsqueda) - CORREGIDO
  static async buscar(termino, limite = 10) {
    try {
      // Validar y limpiar entrada
      if (!termino || typeof termino !== 'string') {
        return [];
      }
      
      const terminoLimpio = termino.trim().replace(/^@/, '');
      
      if (terminoLimpio.length < 2) {
        return [];
      }
      
      // Sanitizar límite (entre 1 y 50)
      const limiteSeguro = Math.min(Math.max(parseInt(limite, 10) || 10, 1), 50);
      
      // IMPORTANTE: LIMIT no puede ser parámetro con execute(), se concatena directamente
      const query = `
        SELECT 
          id, nombre_usuario, nombre_completo, foto_perfil_url, carrera
        FROM usuarios 
        WHERE (nombre_usuario LIKE ? OR nombre_completo LIKE ? OR carrera LIKE ?)
        AND activo = 1
        AND suspendido = 0
        LIMIT ${limiteSeguro}
      `;
      
      const patron = `%${terminoLimpio}%`;
      
      const [usuarios] = await db.execute(query, [
        patron,
        patron,
        patron
      ]);
      
      console.log(`✅ Búsqueda "${terminoLimpio}": ${usuarios.length} resultados`);
      
      return usuarios;
      
    } catch (error) {
      console.error('❌ Error en Usuario.buscar:', error);
      throw error;
    }
  }
  
  // Eliminar usuario (soft delete)
  static async eliminar(id) {
    try {
      const query = `
        UPDATE usuarios 
        SET activo = 0
        WHERE id = ?
      `;
      
      const [resultado] = await db.execute(query, [id]);
      return resultado.affectedRows > 0;
      
    } catch (error) {
      console.error('❌ Error en eliminar:', error);
      throw error;
    }
  }
}

module.exports = Usuario;