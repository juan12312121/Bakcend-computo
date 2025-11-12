const Publicacion = require('../models/Publicacion');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * ============================================
 * CONTROLADOR DE PUBLICACIONES
 * ============================================
 * Maneja todas las operaciones de publicaciones
 * e integración con notificaciones
 * ============================================
 */

/**
 * ========================================
 * OBTENER CATEGORÍAS DISPONIBLES
 * ========================================
 * GET /api/publicaciones/categorias
 */
exports.obtenerCategorias = async (req, res) => {
  try {
    const categorias = Publicacion.getCategorias();
    return successResponse(res, categorias, 'Lista de categorías disponibles');
  } catch (error) {
    console.error('❌ Error al obtener categorías:', error);
    return errorResponse(res, 'Error al obtener categorías', 500);
  }
};

/**
 * ========================================
 * CREAR PUBLICACIÓN
 * ========================================
 * POST /api/publicaciones
 */
exports.crearPublicacion = async (req, res) => {
  try {
    const { contenido, categoria } = req.body;

    if (!contenido) {
      return errorResponse(res, 'El contenido es obligatorio', 400);
    }

    const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
    if (categoria && !categoriasValidas.includes(categoria)) {
      return errorResponse(res, `Categoría inválida. Debe ser una de: ${categoriasValidas.join(', ')}`, 400);
    }

    // ✅ CORREGIDO: Usar imagen_s3 en lugar de imagen_url
    const nuevaPublicacionId = await Publicacion.crear({
      usuario_id: req.usuario.id,
      contenido,
      imagen_url: null,  // ← Dejar como null
      imagen_s3: req.file ? req.file.location : null,  // ← Usar .location de S3
      categoria: categoria || 'General'
    });

    const publicacion = await Publicacion.obtenerPorId(nuevaPublicacionId);

    console.log(`📝 Usuario ${req.usuario.id} creó publicación ${nuevaPublicacionId}`);
    console.log(`📤 Imagen S3: ${req.file ? req.file.location : 'sin imagen'}`);

    return successResponse(res, publicacion, 'Publicación creada exitosamente', 201);
  } catch (error) {
    console.error('❌ Error al crear publicación:', error);
    return errorResponse(res, 'Error al crear publicación', 500);
  }
};

/**
 * ========================================
 * OBTENER PUBLICACIONES (FEED)
 * ========================================
 * GET /api/publicaciones
 */
exports.obtenerPublicaciones = async (req, res) => {
  try {
    console.log('📍 Obteniendo publicaciones...');
    console.log('👤 Usuario autenticado:', req.usuario ? req.usuario.id : 'No autenticado');
    
    let publicaciones;

    // Si no hay usuario autenticado, mostrar publicaciones aleatorias
    if (!req.usuario || !req.usuario.id) {
      console.log('🎲 Mostrando publicaciones aleatorias (usuario no autenticado)');
      publicaciones = await Publicacion.obtenerAleatorias(20);
      return successResponse(res, publicaciones, 'Publicaciones aleatorias');
    }

    // Intentar obtener publicaciones del feed (seguidos + propias)
    try {
      console.log('📱 Obteniendo feed personalizado para usuario:', req.usuario.id);
      publicaciones = await Publicacion.obtenerTodasParaUsuario(req.usuario.id);
      
      console.log('✅ Publicaciones del feed:', publicaciones.length);
      
      // Si el usuario no sigue a nadie, complementar con aleatorias
      if (!publicaciones || publicaciones.length === 0) {
        console.log('🎲 Usuario no sigue a nadie, mostrando aleatorias');
        publicaciones = await Publicacion.obtenerAleatorias(20);
        return successResponse(res, publicaciones, 'Publicaciones aleatorias (no sigues a nadie)');
      }
      
      // Si tiene pocas publicaciones, complementar con aleatorias
      if (publicaciones.length < 5) {
        console.log('📊 Pocas publicaciones, complementando con aleatorias');
        const aleatorias = await Publicacion.obtenerAleatorias(10);
        
        // Filtrar duplicados
        const idsExistentes = new Set(publicaciones.map(p => p.id));
        const nuevas = aleatorias.filter(p => !idsExistentes.has(p.id));
        
        publicaciones = [...publicaciones, ...nuevas];
      }

      return successResponse(res, publicaciones, 'Feed personalizado');
      
    } catch (feedError) {
      console.warn('⚠️ Error al obtener feed personalizado:', feedError.message);
      console.log('🔄 Obteniendo todas las publicaciones como fallback');
      
      publicaciones = await Publicacion.obtenerTodas();
      
      if (!publicaciones || publicaciones.length === 0) {
        return successResponse(res, [], 'No hay publicaciones disponibles');
      }
      
      return successResponse(res, publicaciones, 'Todas las publicaciones');
    }
    
  } catch (error) {
    console.error('❌ Error crítico al obtener publicaciones:', error);
    console.error('Stack:', error.stack);
    
    try {
      const publicacionesBackup = await Publicacion.obtenerTodas();
      return successResponse(res, publicacionesBackup || [], 'Publicaciones (modo backup)');
    } catch (backupError) {
      console.error('❌ Error en backup:', backupError);
      return errorResponse(res, 'Error al obtener publicaciones', 500, [error.message]);
    }
  }
};

/**
 * ========================================
 * OBTENER UNA PUBLICACIÓN POR ID
 * ========================================
 * GET /api/publicaciones/:id
 */
exports.obtenerPublicacion = async (req, res) => {
  try {
    const { id } = req.params;
    const publicacion = await Publicacion.obtenerPorId(id);

    if (!publicacion) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    return successResponse(res, publicacion, 'Publicación encontrada');
  } catch (error) {
    console.error('❌ Error al obtener publicación:', error);
    return errorResponse(res, 'Error al obtener publicación', 500);
  }
};

/**
 * ========================================
 * OBTENER MIS PUBLICACIONES
 * ========================================
 * GET /api/publicaciones/mis-publicaciones
 */
exports.obtenerMisPublicaciones = async (req, res) => {
  try {
    const publicaciones = await Publicacion.obtenerPorUsuario(req.usuario.id);
    
    return successResponse(
      res, 
      publicaciones, 
      publicaciones.length > 0 ? 'Mis publicaciones' : 'No tienes publicaciones aún'
    );
  } catch (error) {
    console.error('❌ Error al obtener mis publicaciones:', error);
    return errorResponse(res, 'Error al obtener mis publicaciones', 500);
  }
};

/**
 * ========================================
 * OBTENER PUBLICACIONES DE OTRO USUARIO
 * ========================================
 * GET /api/publicaciones/usuario/:usuarioId
 */
exports.obtenerPublicacionesUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const publicaciones = await Publicacion.obtenerPorUsuario(usuarioId);
    return successResponse(res, publicaciones, 'Publicaciones del usuario');
  } catch (error) {
    console.error('❌ Error al obtener publicaciones del usuario:', error);
    return errorResponse(res, 'Error al obtener publicaciones del usuario', 500);
  }
};

/**
 * ========================================
 * ACTUALIZAR PUBLICACIÓN
 * ========================================
 * PUT /api/publicaciones/:id
 */
exports.crearPublicacion = async (req, res) => {
  try {
    const { contenido, categoria } = req.body;

    if (!contenido) {
      return errorResponse(res, 'El contenido es obligatorio', 400);
    }

    const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
    if (categoria && !categoriasValidas.includes(categoria)) {
      return errorResponse(res, `Categoría inválida. Debe ser una de: ${categoriasValidas.join(', ')}`, 400);
    }

    const nuevaPublicacionId = await Publicacion.crear({
      usuario_id: req.usuario.id,
      contenido,
      imagen_url: null,
      imagen_s3: req.file ? req.file.location : null,
      categoria: categoria || 'General'
    });

    const publicacion = await Publicacion.obtenerPorId(nuevaPublicacionId);

    console.log(`📝 Usuario ${req.usuario.id} creó publicación ${nuevaPublicacionId}`);
    console.log(`📤 Imagen S3: ${req.file ? req.file.location : 'sin imagen'}`);

    return successResponse(res, publicacion, 'Publicación creada exitosamente', 201);
  } catch (error) {
    console.error('❌ Error al crear publicación:', error);
    return errorResponse(res, 'Error al crear publicación', 500);
  }
};

exports.actualizarPublicacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { contenido, categoria } = req.body;

    // Validar categoría si se proporciona
    if (categoria) {
      const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
      if (!categoriasValidas.includes(categoria)) {
        return errorResponse(res, `Categoría inválida. Debe ser una de: ${categoriasValidas.join(', ')}`, 400);
      }
    }

    const datosActualizar = { contenido, categoria };
    if (req.file) {
      datosActualizar.imagen_s3 = req.file.location;
      datosActualizar.imagen_url = null;
    }

    const actualizado = await Publicacion.actualizar(id, req.usuario.id, datosActualizar);

    if (!actualizado) {
      return errorResponse(res, 'No se pudo actualizar la publicación', 400);
    }

    const publicacionActualizada = await Publicacion.obtenerPorId(id);

    console.log(`✏️ Usuario ${req.usuario.id} actualizó publicación ${id}`);
    console.log(`📤 Imagen S3: ${req.file ? req.file.location : 'sin cambios'}`);

    return successResponse(res, publicacionActualizada, 'Publicación actualizada correctamente');
  } catch (error) {
    console.error('❌ Error al actualizar publicación:', error);
    return errorResponse(res, 'Error al actualizar publicación', 500);
  }
};

/**
 * ========================================
 * ELIMINAR PUBLICACIÓN
 * ========================================
 * DELETE /api/publicaciones/:id
 * 
 * ✅ Elimina la publicación Y todas sus notificaciones asociadas
 */
exports.eliminarPublicacion = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la publicación existe y pertenece al usuario
    const publicacion = await Publicacion.obtenerPorId(id);
    
    if (!publicacion) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    if (publicacion.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'No tienes permiso para eliminar esta publicación', 403);
    }

    // ✅ ELIMINAR TODAS LAS NOTIFICACIONES ASOCIADAS
    // (likes y comentarios de esta publicación)
    const notificacionesEliminadas = await Notificacion.eliminarNotificacionesPublicacion(id);
    console.log(`🔔 Eliminadas ${notificacionesEliminadas} notificaciones de publicación ${id}`);

    // Eliminar la publicación
    // (CASCADE eliminará automáticamente likes y comentarios si está configurado)
    const eliminado = await Publicacion.eliminar(id, req.usuario.id);

    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar la publicación', 400);
    }

    console.log(`🗑️ Usuario ${req.usuario.id} eliminó publicación ${id}`);

    return successResponse(
      res, 
      { 
        deleted: true,
        notificacionesEliminadas 
      }, 
      'Publicación eliminada correctamente'
    );
  } catch (error) {
    console.error('❌ Error al eliminar publicación:', error);
    return errorResponse(res, 'Error al eliminar publicación', 500);
  }
};