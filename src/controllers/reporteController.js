const Reporte = require('../models/Reporte');
const PublicacionOculta = require('../models/PublicacionOculta');
const PublicacionNoInteresa = require('../models/publicaciones_no_interesa');
const { successResponse, errorResponse } = require('../utils/responses');

// ==========================================
// REPORTES
// ==========================================

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

exports.obtenerTodosReportes = async (req, res) => {
  try {
    const reportes = await Reporte.obtenerTodos();
    return successResponse(res, reportes, 'Reportes obtenidos exitosamente');
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    return errorResponse(res, 'Error al obtener reportes', 500);
  }
};

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
// NO ME INTERESA (SIMPLIFICADO)
// ==========================================

exports.marcarNoInteresa = async (req, res) => {
  try {
    const { publicacionId } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    const id = await PublicacionNoInteresa.marcar(usuarioId, publicacionId);
    
    return successResponse(
      res, 
      { id, publicacionId }, 
      'Publicación ocultada. No la verás más en tu feed',
      201
    );
  } catch (error) {
    console.error('❌ Error al ocultar publicación:', error);
    return errorResponse(res, 'Error al ocultar publicación', 500);
  }
};

exports.desmarcarNoInteresa = async (req, res) => {
  try {
    const { publicacionId } = req.body;
    const usuarioId = req.usuario.id;

    if (!publicacionId) {
      return errorResponse(res, 'ID de publicación es obligatorio', 400);
    }

    await PublicacionNoInteresa.desmarcar(usuarioId, publicacionId);
    return successResponse(res, { publicacionId }, 'Publicación visible nuevamente');
  } catch (error) {
    console.error('❌ Error al mostrar publicación:', error);
    return errorResponse(res, 'Error al mostrar publicación', 500);
  }
};

exports.obtenerPublicacionesNoInteresan = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    
    console.log('🔍 Obteniendo publicaciones ocultas para usuario:', usuarioId);
    
    const publicaciones = await PublicacionNoInteresa.obtenerTodas(usuarioId);
    
    console.log('✅ Publicaciones obtenidas:', publicaciones.length);
    
    return successResponse(
      res, 
      publicaciones, 
      'Publicaciones ocultas obtenidas exitosamente'
    );
  } catch (error) {
    console.error('❌ Error completo en obtenerPublicacionesNoInteresan:', {
      mensaje: error.message,
      stack: error.stack,
      code: error.code,
      sqlMessage: error.sqlMessage,
      sql: error.sql
    });
    return errorResponse(res, 'Error al obtener publicaciones ocultas', 500);
  }
};

exports.limpiarNoInteresa = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const cantidad = await PublicacionNoInteresa.limpiarTodas(usuarioId);
    
    return successResponse(
      res, 
      { cantidad }, 
      `${cantidad} publicación(es) visible(s) nuevamente`
    );
  } catch (error) {
    console.error('❌ Error al limpiar publicaciones ocultas:', error);
    return errorResponse(res, 'Error al limpiar publicaciones ocultas', 500);
  }
};