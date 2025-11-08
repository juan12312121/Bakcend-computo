const Like = require('../models/likes');
const { errorResponse, successResponse } = require('../utils/responses');

/**
 * CONTROLADOR DE LIKES
 * Maneja la lógica de negocio para likes
 */

/**
 * Agregar un like a una publicación
 * POST /api/likes
 */
exports.agregarLike = async (req, res) => {
  try {
    const { publicacion_id } = req.body;
    const usuario_id = req.usuario.id;

    // Validar entrada
    if (!publicacion_id) {
      return errorResponse(res, 'publicacion_id es requerido', 400);
    }

    // Verificar que la publicación existe
    const publicacionExiste = await Like.publicacionExiste(publicacion_id);
    if (!publicacionExiste) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    // Verificar si ya existe el like
    const yaExiste = await Like.existe(publicacion_id, usuario_id);
    if (yaExiste) {
      return errorResponse(res, 'Ya has dado like a esta publicación', 400);
    }

    // Agregar el like
    const result = await Like.crear(publicacion_id, usuario_id);
    
    // Incrementar total en publicaciones
    await Like.incrementarTotalPublicacion(publicacion_id);

    console.log('✅ Like agregado exitosamente');
    return successResponse(res, { id: result.insertId }, 'Like agregado exitosamente', 201);

  } catch (error) {
    console.error('❌ Error al agregar like:', error);
    return errorResponse(res, 'Error al agregar like', 500);
  }
};

/**
 * Eliminar un like de una publicación
 * DELETE /api/likes
 */
exports.eliminarLike = async (req, res) => {
  try {
    const { publicacion_id } = req.body;
    const usuario_id = req.usuario.id;

    // Validar entrada
    if (!publicacion_id) {
      return errorResponse(res, 'publicacion_id es requerido', 400);
    }

    // Verificar que existe el like
    const yaExiste = await Like.existe(publicacion_id, usuario_id);
    if (!yaExiste) {
      return errorResponse(res, 'No has dado like a esta publicación', 404);
    }

    // Eliminar el like
    await Like.eliminar(publicacion_id, usuario_id);
    
    // Decrementar total en publicaciones
    await Like.decrementarTotalPublicacion(publicacion_id);

    console.log('✅ Like eliminado exitosamente');
    return successResponse(res, null, 'Like eliminado exitosamente', 200);

  } catch (error) {
    console.error('❌ Error al eliminar like:', error);
    return errorResponse(res, 'Error al eliminar like', 500);
  }
};

/**
 * Obtener todos los likes de una publicación
 * GET /api/likes/publicacion/:publicacion_id
 */
exports.obtenerLikesPublicacion = async (req, res) => {
  try {
    const { publicacion_id } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Validar entrada
    if (!publicacion_id) {
      return errorResponse(res, 'publicacion_id es requerido', 400);
    }

    // Verificar que la publicación existe
    const publicacionExiste = await Like.publicacionExiste(publicacion_id);
    if (!publicacionExiste) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    // Obtener likes
    const likes = await Like.obtenerPorPublicacion(publicacion_id, limit, offset);
    
    // Obtener total
    const total = await Like.obtenerTotal(publicacion_id);

    console.log('✅ Likes obtenidos exitosamente');
    return successResponse(res, {
      data: likes,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    }, 'Likes obtenidos exitosamente', 200);

  } catch (error) {
    console.error('❌ Error al obtener likes:', error);
    return errorResponse(res, 'Error al obtener likes', 500);
  }
};

/**
 * Verificar si el usuario ha dado like
 * GET /api/likes/verificar/:publicacion_id
 */
exports.verificarLike = async (req, res) => {
  try {
    const { publicacion_id } = req.params;
    const usuario_id = req.usuario.id;

    // Validar entrada
    if (!publicacion_id) {
      return errorResponse(res, 'publicacion_id es requerido', 400);
    }

    // Verificar si existe el like
    const existe = await Like.existe(publicacion_id, usuario_id);

    console.log('✅ Verificación de like completada');
    return successResponse(res, { liked: existe }, 'Verificación completada', 200);

  } catch (error) {
    console.error('❌ Error al verificar like:', error);
    return errorResponse(res, 'Error al verificar like', 500);
  }
};

/**
 * Obtener total de likes de una publicación
 * GET /api/likes/total/:publicacion_id
 */
exports.obtenerTotalLikes = async (req, res) => {
  try {
    const { publicacion_id } = req.params;

    // Validar entrada
    if (!publicacion_id) {
      return errorResponse(res, 'publicacion_id es requerido', 400);
    }

    // Verificar que la publicación existe
    const publicacionExiste = await Like.publicacionExiste(publicacion_id);
    if (!publicacionExiste) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    // Obtener total
    const total = await Like.obtenerTotal(publicacion_id);

    console.log('✅ Total de likes obtenido');
    return successResponse(res, { total_likes: total }, 'Total de likes obtenido', 200);

  } catch (error) {
    console.error('❌ Error al obtener total de likes:', error);
    return errorResponse(res, 'Error al obtener total de likes', 500);
  }
};

/**
 * Toggle like - Agregar o eliminar automáticamente
 * POST /api/likes/toggle
 */
exports.toggleLike = async (req, res) => {
  try {
    const { publicacion_id } = req.body;
    const usuario_id = req.usuario.id;

    // Validar entrada
    if (!publicacion_id) {
      return errorResponse(res, 'publicacion_id es requerido', 400);
    }

    // Verificar que la publicación existe
    const publicacionExiste = await Like.publicacionExiste(publicacion_id);
    if (!publicacionExiste) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    // Verificar si ya existe el like
    const existe = await Like.existe(publicacion_id, usuario_id);

    if (existe) {
      // Eliminar like
      await Like.eliminar(publicacion_id, usuario_id);
      await Like.decrementarTotalPublicacion(publicacion_id);
      
      console.log('✅ Like eliminado exitosamente (toggle)');
      return successResponse(res, { liked: false }, 'Like eliminado', 200);
    } else {
      // Agregar like
      const result = await Like.crear(publicacion_id, usuario_id);
      await Like.incrementarTotalPublicacion(publicacion_id);
      
      console.log('✅ Like agregado exitosamente (toggle)');
      return successResponse(res, { liked: true, id: result.insertId }, 'Like agregado', 201);
    }

  } catch (error) {
    console.error('❌ Error al hacer toggle de like:', error);
    return errorResponse(res, 'Error al hacer toggle de like', 500);
  }
};

/**
 * Obtener todos los likes del usuario
 * GET /api/likes/usuario/mis-likes
 */
exports.obtenerMisLikes = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Obtener likes del usuario
    const likes = await Like.obtenerPorUsuario(usuario_id, limit, offset);
    
    // Obtener total
    const total = await Like.obtenerTotalPorUsuario(usuario_id);

    console.log('✅ Mis likes obtenidos exitosamente');
    return successResponse(res, {
      data: likes,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    }, 'Mis likes obtenidos exitosamente', 200);

  } catch (error) {
    console.error('❌ Error al obtener mis likes:', error);
    return errorResponse(res, 'Error al obtener mis likes', 500);
  }
};