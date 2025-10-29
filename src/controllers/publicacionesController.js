const Publicacion = require('../models/Publicacion');
const { successResponse, errorResponse } = require('../utils/responses');

// Crear nueva publicación
exports.crearPublicacion = async (req, res) => {
  try {
    const { contenido, categoria, color_categoria } = req.body;

    if (!contenido) {
      return errorResponse(res, 'El contenido es obligatorio', 400);
    }

    const nuevaPublicacionId = await Publicacion.crear({
      usuario_id: req.usuario.id,
      contenido,
      imagen_url: req.file ? `/uploads/publicaciones/${req.file.filename}` : null,
      categoria,
      color_categoria
    });

    const publicacion = await Publicacion.obtenerPorId(nuevaPublicacionId);

    return successResponse(res, publicacion, 'Publicación creada exitosamente', 201);
  } catch (error) {
    console.error('❌ Error al crear publicación:', error);
    return errorResponse(res, 'Error al crear publicación', 500);
  }
};

// Obtener todas las publicaciones (feed)
exports.obtenerPublicaciones = async (req, res) => {
  try {
    let publicaciones;

    if (!req.usuario) {
      // Usuario no autenticado → mostrar aleatorias
      publicaciones = await Publicacion.obtenerAleatorias();
      return successResponse(res, publicaciones, 'Publicaciones aleatorias para usuario no autenticado');
    }

    // Usuario autenticado → publicaciones de los que sigue + propias
    publicaciones = await Publicacion.obtenerTodasParaUsuario(req.usuario.id);

    // Si no sigue a nadie, mostrar aleatorias
    if (!publicaciones.length) {
      publicaciones = await Publicacion.obtenerAleatorias();
      return successResponse(res, publicaciones, 'Publicaciones aleatorias porque no sigue a nadie');
    }

    return successResponse(res, publicaciones, 'Lista de publicaciones');
  } catch (error) {
    console.error('❌ Error al obtener publicaciones:', error);
    return errorResponse(res, 'Error al obtener publicaciones', 500);
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

// ✅ CORREGIDO: Obtener MIS publicaciones (solo las mías, no las de quienes sigo)
exports.obtenerMisPublicaciones = async (req, res) => {
  try {
    // Usar obtenerPorUsuario en lugar de obtenerTodasParaUsuario
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
    const { contenido, categoria, color_categoria } = req.body;

    const datosActualizar = { contenido, categoria, color_categoria };
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