const db = require('../config/database');

class Publicacion {
    
  static async crear(datos) {
    const query = `
      INSERT INTO publicaciones 
      (usuario_id, contenido, imagen_url, imagen_s3, categoria, color_categoria)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    // Mapeo automático de categoría a color
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

    const [resultado] = await db.execute(query, [
      datos.usuario_id,
      datos.contenido,
      datos.imagen_url || null,
      datos.imagen_s3 || null,
      categoria,
      color
    ]);

    return resultado.insertId;
  }

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

  static async actualizar(id, usuarioId, datos) {
    const campos = [];
    const valores = [];

    // Mapeo de categoría a color
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
      
      // Si cambia la categoría, actualizar el color automáticamente
      if (!datos.color_categoria) {
        campos.push('color_categoria = ?');
        valores.push(categoriaColores[datos.categoria] || 'bg-orange-500');
      }
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

 // 🔧 REEMPLAZA la función obtenerTodasParaUsuario en tu modelo

static async obtenerTodasParaUsuario(usuarioId) {
  try {
    console.log('📱 Obteniendo feed para usuario:', usuarioId);
    
    // Primero verificar si la tabla seguidores existe
    const checkTableQuery = `
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'seguidores'
    `;
    
    const [tableCheck] = await db.execute(checkTableQuery);
    
    if (tableCheck[0].count === 0) {
      console.warn('⚠️ Tabla seguidores no existe, mostrando todas las publicaciones');
      return await this.obtenerTodas();
    }
    
    // Obtener publicaciones del feed (seguidos + propias)
    const query = `
      SELECT DISTINCT P.*, U.nombre_completo, U.nombre_usuario, U.foto_perfil_url
      FROM publicaciones P
      INNER JOIN usuarios U ON U.id = P.usuario_id
      WHERE P.oculto = 0
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
    
    return filas;
    
  } catch (error) {
    console.error('❌ Error en obtenerTodasParaUsuario:', error.message);
    
    // Si hay error con seguidores, devolver solo publicaciones propias + algunas aleatorias
    console.log('🔄 Fallback: obteniendo publicaciones propias + aleatorias');
    
    try {
      const misPublicaciones = await this.obtenerPorUsuario(usuarioId);
      const aleatorias = await this.obtenerAleatorias(20);
      
      // Combinar sin duplicados
      const idsExistentes = new Set(misPublicaciones.map(p => p.id));
      const nuevas = aleatorias.filter(p => !idsExistentes.has(p.id));
      
      return [...misPublicaciones, ...nuevas];
    } catch (fallbackError) {
      console.error('❌ Error en fallback:', fallbackError);
      // Último recurso: todas las publicaciones
      return await this.obtenerTodas();
    }
  }
}

// También asegurémonos de que obtenerTodas tenga LIMIT
static async obtenerTodas() {
  const query = `
    SELECT P.*, U.nombre_completo, U.nombre_usuario, U.foto_perfil_url
    FROM publicaciones P
    INNER JOIN usuarios U ON U.id = P.usuario_id
    WHERE P.oculto = 0
    ORDER BY P.fecha_creacion DESC
    LIMIT 100
  `;
  const [filas] = await db.execute(query);
  console.log('📚 Total publicaciones:', filas.length);
  return filas;
}

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

  // ✅ NUEVO: Obtener lista de categorías disponibles
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