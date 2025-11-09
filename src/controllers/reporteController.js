const Reporte = require('../models/Reporte');
const PublicacionOculta = require('../models/PublicacionOculta');
const PublicacionNoInteresa = require('../models/publicaciones_no_interesa');
const { successResponse, errorResponse } = require('../utils/responses');

// ==========================================
// REPORTES
// ==========================================

/**
 * Crear un reporte de una publicación
 */
exports.crearReporte = async (req, res) => {
  try {
    const { publicacionId, motivo, descripcion } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId || !motivo) {
      return errorResponse(res, 'Publicación y motivo son obligatorios', 400);
    }

    const motivosValidos = [
      'Acoso o bullying',
      'Violencia o daño',
      'Spam o publicidad',
      'Información falsa',
      'Suplantación de identidad',
      'Lenguaje ofensivo',
      'Otro'
    ];

    if (!motivosValidos.includes(motivo)) {
      return errorResponse(res, 'Motivo inválido', 400);
    }

    try {
      const reporteId = await Reporte.crear(publicacionId, usuarioId, motivo, descripcion);
      const totalReportes = await Reporte.contarReportesActivos(publicacionId);

      let mensaje = 'Reporte creado exitosamente';
      let status = 201;

      if (totalReportes >= 5) {
        mensaje = '⚠️ Publicación eliminada por exceso de reportes';
        status = 200;
      }

      return successResponse(res, 
        { reporteId, totalReportes }, 
        mensaje, 
        status
      );
    } catch (error) {
      if (error.message === 'Ya has reportado esta publicación') {
        return errorResponse(res, error.message, 400);
      }
      throw error;
    }
  } catch (error) {
    console.error('Error al crear reporte:', error);
    return errorResponse(res, 'Error al crear reporte', 500);
  }
};

/**
 * Obtener reportes de una publicación específica
 */
exports.obtenerReportes = async (req, res) => {
  try {
    const { publicacionId } = req.params;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    const reportes = await Reporte.obtenerPorPublicacion(publicacionId);
    return successResponse(res, reportes, 'Reportes obtenidos exitosamente');
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    return errorResponse(res, 'Error al obtener reportes', 500);
  }
};

/**
 * Obtener todos los reportes del sistema
 */
exports.obtenerTodosReportes = async (req, res) => {
  try {
    const reportes = await Reporte.obtenerTodos();
    return successResponse(res, reportes, 'Reportes obtenidos exitosamente');
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    return errorResponse(res, 'Error al obtener reportes', 500);
  }
};

/**
 * Obtener estadísticas de reportes por usuario
 */
exports.obtenerEstadisticasReportes = async (req, res) => {
  try {
    const stats = await Reporte.obtenerEstadisticasUsuarios();
    return successResponse(res, stats, 'Estadísticas obtenidas exitosamente');
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    return errorResponse(res, 'Error al obtener estadísticas', 500);
  }
};

// ==========================================
// PUBLICACIONES OCULTAS
// ==========================================

/**
 * Ocultar una publicación (propia o de otros)
 */
exports.ocultarPublicacion = async (req, res) => {
  try {
    const { publicacionId } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    await PublicacionOculta.ocultar(usuarioId, publicacionId);
    return successResponse(res, { publicacionId }, 'Publicación ocultada exitosamente');
  } catch (error) {
    console.error('Error al ocultar publicación:', error);
    return errorResponse(res, 'Error al ocultar publicación', 500);
  }
};

/**
 * Mostrar una publicación previamente oculta
 */
exports.mostrarPublicacion = async (req, res) => {
  try {
    const { publicacionId } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    await PublicacionOculta.mostrar(usuarioId, publicacionId);
    return successResponse(res, { publicacionId }, 'Publicación mostrada exitosamente');
  } catch (error) {
    console.error('Error al mostrar publicación:', error);
    return errorResponse(res, 'Error al mostrar publicación', 500);
  }
};

/**
 * Obtener todas las publicaciones ocultas por el usuario
 */
exports.obtenerPublicacionesOcultas = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const publicaciones = await PublicacionOculta.obtenerOcultas(usuarioId);
    return successResponse(res, publicaciones, 'Publicaciones ocultas obtenidas exitosamente');
  } catch (error) {
    console.error('Error al obtener publicaciones ocultas:', error);
    return errorResponse(res, 'Error al obtener publicaciones ocultas', 500);
  }
};

/**
 * Ocultar TODAS las publicaciones propias del usuario
 */
exports.ocultarTodasPropias = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const cantidad = await PublicacionOculta.ocultarTodasPropias(usuarioId);
    
    return successResponse(
      res, 
      { cantidad }, 
      `${cantidad} publicación(es) propia(s) ocultada(s) exitosamente`
    );
  } catch (error) {
    console.error('Error al ocultar publicaciones propias:', error);
    return errorResponse(res, 'Error al ocultar publicaciones propias', 500);
  }
};

/**
 * Mostrar TODAS las publicaciones propias del usuario
 */
exports.mostrarTodasPropias = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const cantidad = await PublicacionOculta.mostrarTodasPropias(usuarioId);
    
    return successResponse(
      res, 
      { cantidad }, 
      `${cantidad} publicación(es) propia(s) mostrada(s) exitosamente`
    );
  } catch (error) {
    console.error('Error al mostrar publicaciones propias:', error);
    return errorResponse(res, 'Error al mostrar publicaciones propias', 500);
  }
};

/**
 * Obtener solo las publicaciones propias que están ocultas
 */
exports.obtenerPropiasOcultas = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const publicaciones = await PublicacionOculta.obtenerPropiasOcultas(usuarioId);
    return successResponse(
      res, 
      publicaciones, 
      'Publicaciones propias ocultas obtenidas exitosamente'
    );
  } catch (error) {
    console.error('Error al obtener publicaciones propias ocultas:', error);
    return errorResponse(res, 'Error al obtener publicaciones propias ocultas', 500);
  }
};

// ==========================================
// NO ME INTERESA
// ==========================================

/**
 * Marcar una publicación como "No me interesa"
 */
exports.marcarNoInteresa = async (req, res) => {
  try {
    const { publicacionId } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    const id = await PublicacionNoInteresa.marcar(usuarioId, publicacionId);
    
    // Obtener cuántas publicaciones ha marcado
    const total = await PublicacionNoInteresa.contarPorUsuario(usuarioId);
    
    return successResponse(
      res, 
      { id, publicacionId, totalMarcadas: total }, 
      '✓ Marcado como "No me interesa". Verás menos publicaciones similares',
      201
    );
  } catch (error) {
    console.error('Error al marcar "No me interesa":', error);
    return errorResponse(res, 'Error al marcar "No me interesa"', 500);
  }
};

/**
 * Desmarcar "No me interesa" de una publicación
 */
exports.desmarcarNoInteresa = async (req, res) => {
  try {
    const { publicacionId } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    await PublicacionNoInteresa.desmarcar(usuarioId, publicacionId);
    return successResponse(res, { publicacionId }, 'Desmarcado "No me interesa"');
  } catch (error) {
    console.error('Error al desmarcar "No me interesa":', error);
    return errorResponse(res, 'Error al desmarcar "No me interesa"', 500);
  }
};

/**
 * Obtener todas las publicaciones marcadas como "No me interesa"
 */
exports.obtenerPublicacionesNoInteresan = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const publicaciones = await PublicacionNoInteresa.obtenerTodas(usuarioId);
    return successResponse(
      res, 
      publicaciones, 
      'Publicaciones "No me interesa" obtenidas exitosamente'
    );
  } catch (error) {
    console.error('Error al obtener publicaciones "No me interesa":', error);
    return errorResponse(res, 'Error al obtener publicaciones "No me interesa"', 500);
  }
};

/**
 * Obtener categorías que el usuario ha marcado frecuentemente como "No me interesa"
 */
exports.obtenerCategoriasNoInteresan = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const categorias = await PublicacionNoInteresa.obtenerCategoriasNoInteresan(usuarioId);
    return successResponse(
      res, 
      categorias, 
      'Categorías que no te interesan obtenidas exitosamente'
    );
  } catch (error) {
    console.error('Error al obtener categorías:', error);
    return errorResponse(res, 'Error al obtener categorías', 500);
  }
};

/**
 * Obtener estadísticas generales de "No me interesa" del usuario
 */
exports.obtenerEstadisticasNoInteresa = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const stats = await PublicacionNoInteresa.obtenerEstadisticas(usuarioId);
    return successResponse(
      res, 
      stats, 
      'Estadísticas de "No me interesa" obtenidas exitosamente'
    );
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    return errorResponse(res, 'Error al obtener estadísticas', 500);
  }
};

/**
 * Limpiar todas las marcas "No me interesa" del usuario
 */
exports.limpiarNoInteresa = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const cantidad = await PublicacionNoInteresa.limpiarTodas(usuarioId);
    
    return successResponse(
      res, 
      { cantidad }, 
      `${cantidad} marca(s) de "No me interesa" eliminada(s)`
    );
  } catch (error) {
    console.error('Error al limpiar "No me interesa":', error);
    return errorResponse(res, 'Error al limpiar "No me interesa"', 500);
  }
};

/**
 * Limpiar marcas "No me interesa" de una categoría específica
 */
exports.limpiarNoInteresaCategoria = async (req, res) => {
  try {
    const { categoria } = req.body;
    const usuarioId = req.usuario.id;

    if (!categoria) {
      return errorResponse(res, 'Categoría es obligatoria', 400);
    }

    const cantidad = await PublicacionNoInteresa.limpiarPorCategoria(usuarioId, categoria);
    
    return successResponse(
      res, 
      { categoria, cantidad }, 
      `${cantidad} marca(s) de "No me interesa" eliminada(s) de la categoría "${categoria}"`
    );
  } catch (error) {
    console.error('Error al limpiar categoría:', error);
    return errorResponse(res, 'Error al limpiar categoría', 500);
  }
};