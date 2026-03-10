const Comentario = require('../models/Comentario');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');
const { getIo } = require('../config/socket');

/**
 * ============================================
 * CONTROLADOR DE COMENTARIOS - SIN IA
 * ============================================
 */

const comentarioController = {

  /**
   * ========================================
   * CENSURAR COMENTARIO (DESACTIVADO)
   * ========================================
   */
  async censurarComentario(texto) {
    return {
      texto_censurado: texto,
      fue_censurado: false,
      nivel_censura: 'ninguno',
      palabras_censuradas: 0,
      requiere_revision: false,
      razon: 'Aprobado automáticamente',
      metodo: 'local'
    };
  },

  /**
   * ========================================
   * CREAR COMENTARIO
   * ========================================
   */
  async crear(req, res) {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║  📝 CREAR COMENTARIO - INICIO          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    try {
      const { publicacion_id, texto } = req.body;
      const usuario_id = req.usuario.id;

      console.log('📊 DATOS RECIBIDOS:');
      console.log('   Usuario ID:', usuario_id);
      console.log('   Publicación ID:', publicacion_id);
      console.log('   Texto:', texto);
      console.log('   Longitud texto:', texto?.length);

      // Validaciones
      if (!publicacion_id || !texto) {
        console.log('❌ Validación falló: Faltan campos');
        return errorResponse(res, 'El ID de publicación y el texto son requeridos', 400);
      }

      if (texto.trim().length === 0) {
        console.log('❌ Validación falló: Texto vacío');
        return errorResponse(res, 'El comentario no puede estar vacío', 400);
      }

      if (texto.length > 1000) {
        console.log('❌ Validación falló: Texto muy largo');
        return errorResponse(res, 'El comentario no puede exceder 1000 caracteres', 400);
      }

      console.log('✅ Validaciones pasadas');
      console.log('');
      console.log('🔍 Llamando a censurarComentario()...');
      console.log('');

      const resultadoCensura = await comentarioController.censurarComentario(texto);

      console.log('');
      console.log('╔════════════════════════════════════════╗');
      console.log('║  ✅ CENSURA COMPLETADA                 ║');
      console.log('╚════════════════════════════════════════╝');
      console.log('📊 Resultado completo:');
      console.log(JSON.stringify(resultadoCensura, null, 2));
      console.log('');
      console.log('📝 Comparación:');
      console.log('   Texto ORIGINAL :', texto);
      console.log('   Texto CENSURADO:', resultadoCensura.texto_censurado);
      console.log('   ¿Son iguales?  :', texto === resultadoCensura.texto_censurado);
      console.log('');

      const textoFinal = resultadoCensura.texto_censurado;
      console.log('💾 Texto que se guardará en BD:', textoFinal);
      console.log('');

      // Guardar
      console.log('💾 Guardando comentario en BD...');
      const comentarioId = await Comentario.crear(publicacion_id, usuario_id, textoFinal);
      console.log('✅ Comentario guardado con ID:', comentarioId);

      // Notificación
      console.log('📧 Creando notificación...');
      await Notificacion.crearNotificacionComentario(publicacion_id, usuario_id);
      console.log('✅ Notificación creada');

      // Obtener comentario completo
      console.log('📖 Obteniendo comentario de BD...');
      const comentario = await Comentario.obtenerPorId(comentarioId);
      console.log('📊 Comentario obtenido:', JSON.stringify(comentario, null, 2));
      console.log('');

      console.log('╔════════════════════════════════════════╗');
      console.log('║  📤 ENVIANDO RESPUESTA AL CLIENTE      ║');
      console.log('╚════════════════════════════════════════╝');
      const respuesta = {
        ...comentario,
        _censura: {
          fue_censurado: resultadoCensura.fue_censurado,
          nivel: resultadoCensura.nivel_censura,
          palabras_censuradas: resultadoCensura.palabras_censuradas,
          metodo: resultadoCensura.metodo
        }
      };
      console.log('Respuesta completa:', JSON.stringify(respuesta, null, 2));
      console.log('');

      // Emitir evento por Socket.io
      try {
        getIo().emit('new_comment', respuesta);
        console.log('📡 Evento new_comment emitido para publicación:', publicacion_id);
      } catch (socketError) {
        console.error('❌ Error al emitir evento Socket.io:', socketError);
      }

      return successResponse(
        res,
        respuesta,
        resultadoCensura.fue_censurado
          ? 'Comentario creado exitosamente (contenido moderado)'
          : 'Comentario creado exitosamente',
        201
      );
    } catch (error) {
      console.log('');
      console.log('╔════════════════════════════════════════╗');
      console.log('║  ❌ ERROR EN CREAR COMENTARIO          ║');
      console.log('╚════════════════════════════════════════╝');
      console.error('Error completo:', error);
      console.error('Stack:', error.stack);
      console.log('');
      return errorResponse(res, 'Error al crear el comentario', 500);
    }
  },

  /**
   * ========================================
   * OBTENER COMENTARIOS POR PUBLICACIÓN
   * ========================================
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
   */
  async actualizar(req, res) {
    try {
      const { id } = req.params;
      const { texto } = req.body;
      const usuario_id = req.usuario.id;

      console.log('========================================');
      console.log('✏️  ACTUALIZAR COMENTARIO');
      console.log('ID:', id);
      console.log('Texto nuevo:', texto);
      console.log('========================================');

      // Validaciones
      if (!texto) {
        return errorResponse(res, 'El texto es requerido', 400);
      }

      if (texto.trim().length === 0) {
        return errorResponse(res, 'El comentario no puede estar vacío', 400);
      }

      if (texto.length > 1000) {
        return errorResponse(res, 'El comentario no puede exceder 1000 caracteres', 400);
      }

      // Verificar permisos
      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return errorResponse(res, 'No tienes permiso para editar este comentario', 403);
      }

      // Censura
      console.log('🔍 Censurando texto actualizado...');
      const resultadoCensura = await comentarioController.censurarComentario(texto);
      console.log('✅ Censura completada:', resultadoCensura.metodo);

      const textoFinal = resultadoCensura.texto_censurado;

      // Actualizar
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
            palabras_censuradas: resultadoCensura.palabras_censuradas,
            metodo: resultadoCensura.metodo
          }
        },
        resultadoCensura.fue_censurado
          ? 'Comentario actualizado exitosamente (contenido moderado)'
          : 'Comentario actualizado exitosamente',
        200
      );
    } catch (error) {
      console.error('❌ ERROR AL ACTUALIZAR:', error);
      return errorResponse(res, 'Error al actualizar el comentario', 500);
    }
  },

  /**
   * ========================================
   * ELIMINAR COMENTARIO
   * ========================================
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