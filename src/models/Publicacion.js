const db = require('../config/database');
const PublicacionOculta = require('./PublicacionOculta');
const Documento = require('./Documento');

class Publicacion {
    
  /**
   * Crear nueva publicación
   * @param {object} datos - Datos de la publicación
   */
  static async crear(datos) {
    const query = `
      INSERT INTO publicaciones 
      (usuario_id, contenido, imagen_url, imagen_s3, categoria, color_categoria, requiere_revision, analisis_censura)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const categoriaColores = {
      'General': 'bg-orange-500',
      'Tecnología': 'bg-teal-500',
      'Ciencias': 'bg-purple-500',
      'Artes y Cultura': 'bg-pink-500',
      'Deportes': 'bg-blue-500',
      'Salud y Bienestar': 'bg-green-500',
      'Vida Universitaria': 'bg-orange-600',
      'Opinión': 'bg-indigo-500',
      'Entrevistas': 'bg-yellow-500'
    };

    const categoria = datos.categoria || 'General';
    const color = datos.color_categoria || categoriaColores[categoria] || 'bg-orange-500';
    const requiereRevision = datos.requiere_revision || 0;
    const analisisCensura = datos.analisis_censura || null;

    const [resultado] = await db.execute(query, [
      datos.usuario_id,
      datos.contenido,
      datos.imagen_url || null,
      datos.imagen_s3 || null,
      categoria,
      color,
      requiereRevision,
      analisisCensura
    ]);

    return resultado.insertId;
  }

  /**
   * Obtener todas las publicaciones (públicas) - ✅ CON CONTADORES
   */
  static async obtenerTodas() {
    try {
      const checkColumn = `
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'suspendido'
      `;
      const [columnExists] = await db.execute(checkColumn);
      
      let query = `
        SELECT 
          P.*,
          P.total_likes,
          P.total_comentarios,
          P.total_compartidos,
          U.nombre_completo, 
          U.nombre_usuario, 
          U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0
      `;
      
      if (columnExists.length > 0) {
        query += ` AND U.suspendido = 0`;
      }
      
      query += ` ORDER BY P.fecha_creacion DESC LIMIT 100`;
      
      const [filas] = await db.execute(query);
      
      // Agregar documentos a cada publicación
      for (let publicacion of filas) {
        publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
      }
      
      return filas;
    } catch (error) {
      console.error('Error en obtenerTodas:', error);
      const query = `
        SELECT 
          P.*,
          P.total_likes,
          P.total_comentarios,
          P.total_compartidos,
          U.nombre_completo, 
          U.nombre_usuario, 
          U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0
        ORDER BY P.fecha_creacion DESC
        LIMIT 100
      `;
      const [filas] = await db.execute(query);
      
      for (let publicacion of filas) {
        publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
      }
      
      return filas;
    }
  }

  /**
   * Obtener publicación por ID - ✅ CON CONTADORES
   */
  static async obtenerPorId(id) {
    const query = `
      SELECT 
        P.*, 
        P.total_likes,
        P.total_comentarios,
        P.total_compartidos,
        U.nombre_usuario, 
        U.nombre_completo, 
        U.foto_perfil_url, 
        U.suspendido
      FROM publicaciones P
      INNER JOIN usuarios U ON U.id = P.usuario_id
      WHERE P.id = ?
    `;
    const [filas] = await db.execute(query, [id]);
    
    if (!filas[0]) return null;
    
    const publicacion = filas[0];
    
    if (publicacion.analisis_censura) {
      try {
        publicacion.analisis_censura = JSON.parse(publicacion.analisis_censura);
      } catch (e) {
        console.warn('No se pudo parsear análisis_censura:', e.message);
      }
    }
    
    publicacion.documentos = await Documento.obtenerPorPublicacion(id);
    
    return publicacion;
  }

  /**
   * Actualizar publicación
   */
  static async actualizar(id, usuarioId, datos) {
    const campos = [];
    const valores = [];

    const categoriaColores = {
      'General': 'bg-orange-500',
      'Tecnología': 'bg-teal-500',
      'Ciencias': 'bg-purple-500',
      'Artes y Cultura': 'bg-pink-500',
      'Deportes': 'bg-blue-500',
      'Salud y Bienestar': 'bg-green-500',
      'Vida Universitaria': 'bg-orange-600',
      'Opinión': 'bg-indigo-500',
      'Entrevistas': 'bg-yellow-500'
    };

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
      
      if (!datos.color_categoria) {
        campos.push('color_categoria = ?');
        valores.push(categoriaColores[datos.categoria] || 'bg-orange-500');
      }
    }
    if (datos.color_categoria !== undefined) {
      campos.push('color_categoria = ?');
      valores.push(datos.color_categoria);
    }
    if (datos.requiere_revision !== undefined) {
      campos.push('requiere_revision = ?');
      valores.push(datos.requiere_revision);
    }
    if (datos.analisis_censura !== undefined) {
      campos.push('analisis_censura = ?');
      valores.push(datos.analisis_censura);
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

  /**
   * Eliminar publicación (marca como oculta)
   */
  static async eliminar(id, usuarioId) {
    const query = `
      UPDATE publicaciones
      SET oculto = 1
      WHERE id = ? AND usuario_id = ?
    `;
    const [resultado] = await db.execute(query, [id, usuarioId]);
    return resultado.affectedRows > 0;
  }

  /**
   * Obtener publicaciones aleatorias - ✅ CON CONTADORES
   */
  static async obtenerAleatorias(limit = 10) {
    try {
      const limitNum = parseInt(limit) || 10;
      
      const checkColumn = `
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'suspendido'
      `;
      const [columnExists] = await db.execute(checkColumn);

      let query = `
        SELECT 
          P.*,
          P.total_likes,
          P.total_comentarios,
          P.total_compartidos,
          U.nombre_completo, 
          U.nombre_usuario, 
          U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0
      `;

      if (columnExists.length > 0) {
        query += ` AND U.suspendido = 0`;
      }

      query += ` ORDER BY RAND() LIMIT ${limitNum}`;

      const [filas] = await db.execute(query);
      
      for (let publicacion of filas) {
        publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
      }
      
      return filas;
    } catch (error) {
      console.error('Error en obtenerAleatorias:', error);
      throw error;
    }
  }

  /**
   * Obtener feed personalizado para un usuario - ✅ CON CONTADORES
   */
  static async obtenerTodasParaUsuario(usuarioId) {
    try {
      console.log('📱 Obteniendo feed para usuario:', usuarioId);
      
      const publicacionesOcultas = await PublicacionOculta.obtenerIdsPorUsuario(usuarioId);
      let ocultasClause = '';
      
      if (publicacionesOcultas.length > 0) {
        ocultasClause = `AND P.id NOT IN (${publicacionesOcultas.join(',')})`;
      }
      
      const checkTableQuery = `
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
        AND table_name = 'seguidores'
      `;
      
      const [tableCheck] = await db.execute(checkTableQuery);
      
      if (tableCheck[0].count === 0) {
        console.warn('⚠️ Tabla seguidores no existe');
        const query = `
          SELECT 
            P.*,
            P.total_likes,
            P.total_comentarios,
            P.total_compartidos,
            U.nombre_completo, 
            U.nombre_usuario, 
            U.foto_perfil_url
          FROM publicaciones P
          INNER JOIN usuarios U ON U.id = P.usuario_id
          WHERE P.oculto = 0 AND U.suspendido = 0 ${ocultasClause}
          ORDER BY P.fecha_creacion DESC
          LIMIT 100
        `;
        const [filas] = await db.execute(query);
        
        for (let publicacion of filas) {
          publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
        }
        
        return filas;
      }
      
      const query = `
        SELECT DISTINCT 
          P.*,
          P.total_likes,
          P.total_comentarios,
          P.total_compartidos,
          U.nombre_completo, 
          U.nombre_usuario, 
          U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0
          AND U.suspendido = 0
          ${ocultasClause}
          AND (
            P.usuario_id = ?
            OR P.usuario_id IN (
              SELECT seguido_id 
              FROM seguidores 
              WHERE seguidor_id = ?
            )
          )
        ORDER BY P.fecha_creacion DESC
        LIMIT 100
      `;
      
      const [filas] = await db.execute(query, [usuarioId, usuarioId]);
      console.log('✅ Publicaciones encontradas:', filas.length);
      
      for (let publicacion of filas) {
        publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
      }
      
      return filas;
      
    } catch (error) {
      console.error('❌ Error en obtenerTodasParaUsuario:', error.message);
      
      try {
        const misPublicaciones = await this.obtenerPorUsuario(usuarioId);
        const aleatorias = await this.obtenerAleatorias(20);
        
        const idsExistentes = new Set(misPublicaciones.map(p => p.id));
        const nuevas = aleatorias.filter(p => !idsExistentes.has(p.id));
        
        return [...misPublicaciones, ...nuevas];
      } catch (fallbackError) {
        console.error('❌ Error en fallback:', fallbackError);
        return await this.obtenerTodas();
      }
    }
  }

  /**
   * Obtener publicaciones de un usuario específico - ✅ CON CONTADORES
   */
  static async obtenerPorUsuario(usuarioId) {
    try {
      const checkColumn = `
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'suspendido'
      `;
      const [columnExists] = await db.execute(checkColumn);
      
      let query = `
        SELECT 
          P.*,
          P.total_likes,
          P.total_comentarios,
          P.total_compartidos,
          U.nombre_completo, 
          U.nombre_usuario, 
          U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0 AND P.usuario_id = ?
      `;
      
      if (columnExists.length > 0) {
        query += ` AND U.suspendido = 0`;
      }
      
      query += ` ORDER BY P.fecha_creacion DESC`;
      
      const [filas] = await db.execute(query, [usuarioId]);
      
      for (let publicacion of filas) {
        publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
      }
      
      return filas;
    } catch (error) {
      console.error('Error en obtenerPorUsuario:', error);
      const query = `
        SELECT 
          P.*,
          P.total_likes,
          P.total_comentarios,
          P.total_compartidos,
          U.nombre_completo, 
          U.nombre_usuario, 
          U.foto_perfil_url
        FROM publicaciones P
        INNER JOIN usuarios U ON U.id = P.usuario_id
        WHERE P.oculto = 0 AND P.usuario_id = ?
        ORDER BY P.fecha_creacion DESC
      `;
      const [filas] = await db.execute(query, [usuarioId]);
      
      for (let publicacion of filas) {
        publicacion.documentos = await Documento.obtenerPorPublicacion(publicacion.id);
      }
      
      return filas;
    }
  }

  static async existeYPerteneceAUsuario(publicacionId, usuarioId) {
  const query = `
    SELECT id FROM publicaciones 
    WHERE id = ? AND usuario_id = ? AND oculto = 0
  `;
  const [filas] = await db.execute(query, [publicacionId, usuarioId]);
  return filas.length > 0;
}

  /**
   * Obtener todas las categorías disponibles
   */
  static getCategorias() {
    return [
      { value: 'General', label: 'General', color: 'bg-orange-500' },
      { value: 'Tecnología', label: 'Tecnología', color: 'bg-teal-500' },
      { value: 'Ciencias', label: 'Ciencias', color: 'bg-purple-500' },
      { value: 'Artes y Cultura', label: 'Artes y Cultura', color: 'bg-pink-500' },
      { value: 'Deportes', label: 'Deportes', color: 'bg-blue-500' },
      { value: 'Salud y Bienestar', label: 'Salud y Bienestar', color: 'bg-green-500' },
      { value: 'Vida Universitaria', label: 'Vida Universitaria', color: 'bg-orange-600' },
      { value: 'Opinión', label: 'Opinión', color: 'bg-indigo-500' },
      { value: 'Entrevistas', label: 'Entrevistas', color: 'bg-yellow-500' }
    ];
  }
}

module.exports = Publicacion;