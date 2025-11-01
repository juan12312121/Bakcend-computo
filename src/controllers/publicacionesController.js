const Publicacion = require('../models/Publicacion');
const { successResponse, errorResponse } = require('../utils/responses');

// ✅ NUEVO: Endpoint para obtener categorías disponibles
exports.obtenerCategorias = async (req, res) => {
  try {
    const categorias = Publicacion.getCategorias();
    return successResponse(res, categorias, 'Lista de categorías disponibles');
  } catch (error) {
    console.error('❌ Error al obtener categorías:', error);
    return errorResponse(res, 'Error al obtener categorías', 500);
  }
};

// Crear nueva publicación
exports.crearPublicacion = async (req, res) => {
  try {
    const { contenido, categoria } = req.body;

    if (!contenido) {
      return errorResponse(res, 'El contenido es obligatorio', 400);
    }

    // Validar categoría si se proporciona
    const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
    if (categoria && !categoriasValidas.includes(categoria)) {
      return errorResponse(res, `Categoría inválida. Debe ser una de: ${categoriasValidas.join(', ')}`, 400);
    }

    const nuevaPublicacionId = await Publicacion.crear({
      usuario_id: req.usuario.id,
      contenido,
      imagen_url: req.file ? `/uploads/publicaciones/${req.file.filename}` : null,
      categoria: categoria || 'General'
      // color_categoria se asigna automáticamente en el modelo
    });

    const publicacion = await Publicacion.obtenerPorId(nuevaPublicacionId);

    return successResponse(res, publicacion, 'Publicación creada exitosamente', 201);
  } catch (error) {
    console.error('❌ Error al crear publicación:', error);
    return errorResponse(res, 'Error al crear publicación', 500);
  }
};

// Obtener todas las publicaciones (feed)
// 🔧 REEMPLAZA la función obtenerPublicaciones en tu controlador

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
      // Si falla obtener el feed (ej: tabla seguidores no existe)
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
    
    // Intentar devolver algo en lugar de error 500
    try {
      const publicacionesBackup = await Publicacion.obtenerTodas();
      return successResponse(res, publicacionesBackup || [], 'Publicaciones (modo backup)');
    } catch (backupError) {
      console.error('❌ Error en backup:', backupError);
      return errorResponse(res, 'Error al obtener publicaciones', 500, [error.message]);
    }
  }
};

// Obtener una publicación por ID
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

// Obtener publicaciones de otro usuario
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

// Actualizar publicación
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
      datosActualizar.imagen_url = `/uploads/publicaciones/${req.file.filename}`;
    }

    const actualizado = await Publicacion.actualizar(id, req.usuario.id, datosActualizar);

    if (!actualizado) {
      return errorResponse(res, 'No se pudo actualizar la publicación', 400);
    }

    const publicacionActualizada = await Publicacion.obtenerPorId(id);
    return successResponse(res, publicacionActualizada, 'Publicación actualizada correctamente');
  } catch (error) {
    console.error('❌ Error al actualizar publicación:', error);
    return errorResponse(res, 'Error al actualizar publicación', 500);
  }
};

// Eliminar publicación
exports.eliminarPublicacion = async (req, res) => {
  try {
    const { id } = req.params;

    const eliminado = await Publicacion.eliminar(id, req.usuario.id);

    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar la publicación', 400);
    }

    return successResponse(res, null, 'Publicación eliminada correctamente');
  } catch (error) {
    console.error('❌ Error al eliminar publicación:', error);
    return errorResponse(res, 'Error al eliminar publicación', 500);
  }
};