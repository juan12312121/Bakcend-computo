const Comentario = require('../models/Comentario');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');
const { 
  obtenerModelo, 
  CONFIG_VALIDACION, 
  PROMPTS, 
  TIMEOUTS,
  ejecutarConReintentos,
  extraerJSON,
  formatearPrompt
} = require('../config/gemini');

/**
 * ============================================
 * CONTROLADOR DE COMENTARIOS
 * ============================================
 * Maneja todas las operaciones de comentarios
 * e integración con notificaciones y censura
 * ============================================
 */

const comentarioController = {

  /**
   * ========================================
   * CENSURAR COMENTARIO CON GEMINI
   * ========================================
   * Analiza el comentario y censura palabras inapropiadas
   */
  async censurarComentario(texto) {
    try {
      const modelo = obtenerModelo('FLASH');
      const prompt = formatearPrompt(PROMPTS.CENSURA_COMENTARIO, {
        comentario: texto
      });

      const resultado = await Promise.race([
        ejecutarConReintentos(async () => {
          const respuesta = await modelo.generateContent({
            contents: [{ 
              role: 'user', 
              parts: [{ text: prompt }] 
            }],
            generationConfig: CONFIG_VALIDACION
          });
          
          return respuesta.response.text();
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), TIMEOUTS.CENSURA)
        )
      ]);

      const analisis = extraerJSON(resultado);

      let textoCensurado = texto;
      
      if (analisis.palabras_censurar && analisis.palabras_censurar.length > 0) {
        for (const item of analisis.palabras_censurar) {
          const palabra = item.palabra;
          const censura = '*'.repeat(palabra.length);
          const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
          textoCensurado = textoCensurado.replace(regex, censura);
        }
      }

      return {
        texto_censurado: textoCensurado,
        fue_censurado: analisis.palabras_censurar?.length > 0,
        nivel_censura: analisis.nivel_censura,
        palabras_censuradas: analisis.palabras_censurar?.length || 0,
        requiere_revision: analisis.requiere_revision_humana || false,
        razon: analisis.razon || null
      };

    } catch (error) {
      return {
        texto_censurado: texto,
        fue_censurado: false,
        nivel_censura: 'error',
        palabras_censuradas: 0,
        requiere_revision: true,
        razon: 'Error en sistema de censura automática'
      };
    }
  },

  /**
   * ========================================
   * CREAR COMENTARIO
   * ========================================
   * POST /api/comentarios
   */
  async crear(req, res) {
    try {
      const { publicacion_id, texto } = req.body;
      const usuario_id = req.usuario.id;

      if (!publicacion_id || !texto) {
        return errorResponse(res, 'El ID de publicación y el texto son requeridos', 400);
      }

      if (texto.trim().length === 0) {
        return errorResponse(res, 'El comentario no puede estar vacío', 400);
      }

      if (texto.length > 1000) {
        return errorResponse(res, 'El comentario no puede exceder 1000 caracteres', 400);
      }

      const resultadoCensura = await comentarioController.censurarComentario(texto);
      const textoFinal = resultadoCensura.texto_censurado;

      const comentarioId = await Comentario.crear(publicacion_id, usuario_id, textoFinal);
      
      await Notificacion.crearNotificacionComentario(publicacion_id, usuario_id);
      
      const comentario = await Comentario.obtenerPorId(comentarioId);

      return successResponse(
        res,
        {
          ...comentario,
          _censura: {
            fue_censurado: resultadoCensura.fue_censurado,
            nivel: resultadoCensura.nivel_censura,
            palabras_censuradas: resultadoCensura.palabras_censuradas
          }
        },
        resultadoCensura.fue_censurado 
          ? 'Comentario creado exitosamente (contenido moderado)'
          : 'Comentario creado exitosamente',
        201
      );
    } catch (error) {
      return errorResponse(res, 'Error al crear el comentario', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIOS POR PUBLICACIÓN
   * ========================================
   * GET /api/comentarios/publicacion/:publicacion_id
   */
  async obtenerPorPublicacion(req, res) {
    try {
      const { publicacion_id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const comentarios = await Comentario.obtenerPorPublicacion(publicacion_id, limit, offset);
      const total = await Comentario.contarPorPublicacion(publicacion_id);

      return successResponse(
        res,
        {
          comentarios,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        },
        'Comentarios obtenidos correctamente',
        200
      );
    } catch (error) {
      return errorResponse(res, 'Error al obtener los comentarios', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIOS POR USUARIO
   * ========================================
   * GET /api/comentarios/usuario/:usuario_id
   */
  async obtenerPorUsuario(req, res) {
    try {
      const { usuario_id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const comentarios = await Comentario.obtenerPorUsuario(usuario_id, limit, offset);

      return successResponse(
        res,
        {
          comentarios,
          pagination: { limit, offset }
        },
        'Comentarios del usuario obtenidos correctamente',
        200
      );
    } catch (error) {
      return errorResponse(res, 'Error al obtener los comentarios del usuario', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIO POR ID
   * ========================================
   * GET /api/comentarios/:id
   */
  async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      const comentario = await Comentario.obtenerPorId(id);

      if (!comentario) {
        return errorResponse(res, 'Comentario no encontrado', 404);
      }

      return successResponse(res, comentario, 'Comentario obtenido correctamente', 200);
    } catch (error) {
      return errorResponse(res, 'Error al obtener el comentario', 500);
    }
  },

  /**
   * ========================================
   * ACTUALIZAR COMENTARIO
   * ========================================
   * PUT /api/comentarios/:id
   */
  async actualizar(req, res) {
    try {
      const { id } = req.params;
      const { texto } = req.body;
      const usuario_id = req.usuario.id;

      if (!texto) {
        return errorResponse(res, 'El texto es requerido', 400);
      }

      if (texto.trim().length === 0) {
        return errorResponse(res, 'El comentario no puede estar vacío', 400);
      }

      if (texto.length > 1000) {
        return errorResponse(res, 'El comentario no puede exceder 1000 caracteres', 400);
      }

      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return errorResponse(res, 'No tienes permiso para editar este comentario', 403);
      }

      const resultadoCensura = await comentarioController.censurarComentario(texto);
      const textoFinal = resultadoCensura.texto_censurado;

      const actualizado = await Comentario.actualizar(id, textoFinal);

      if (!actualizado) {
        return errorResponse(res, 'Comentario no encontrado', 404);
      }

      const comentario = await Comentario.obtenerPorId(id);

      return successResponse(
        res,
        {
          ...comentario,
          _censura: {
            fue_censurado: resultadoCensura.fue_censurado,
            nivel: resultadoCensura.nivel_censura,
            palabras_censuradas: resultadoCensura.palabras_censuradas
          }
        },
        resultadoCensura.fue_censurado
          ? 'Comentario actualizado exitosamente (contenido moderado)'
          : 'Comentario actualizado exitosamente',
        200
      );
    } catch (error) {
      return errorResponse(res, 'Error al actualizar el comentario', 500);
    }
  },

  /**
   * ========================================
   * ELIMINAR COMENTARIO
   * ========================================
   * DELETE /api/comentarios/:id
   */
  async eliminar(req, res) {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return errorResponse(res, 'No tienes permiso para eliminar este comentario', 403);
      }

      const eliminado = await Comentario.eliminar(id);

      if (!eliminado) {
        return errorResponse(res, 'Comentario no encontrado', 404);
      }

      return successResponse(res, null, 'Comentario eliminado exitosamente', 200);
    } catch (error) {
      return errorResponse(res, 'Error al eliminar el comentario', 500);
    }
  }
};

module.exports = comentarioController;