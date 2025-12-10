const Comentario = require('../models/Comentario');
const Notificacion = require('../models/Notificacion');
const { successResponse, errorResponse } = require('../utils/responses');
const {
  obtenerModelo,
  obtenerModeloConFallback,
  CONFIG_VALIDACION,
  PROMPTS,
  TIMEOUTS,
  SAFETY_SETTINGS,
  ejecutarConReintentos,
  extraerJSON,
  extraerTextoRespuesta,
  formatearPrompt,
  censurarManualmente
} = require('../config/gemini');

/**
 * ============================================
 * CONTROLADOR DE COMENTARIOS - VERSIÓN CORREGIDA
 * ============================================
 */

const comentarioController = {

  /**
   * ========================================
   * CENSURAR COMENTARIO CON GEMINI O MANUAL
   * ========================================
   */
  async censurarComentario(texto) {
    console.log('');
    console.log('========================================');
    console.log('🔍 censurarComentario() LLAMADA');
    console.log('📝 Texto recibido:', texto);
    console.log('📝 Tipo:', typeof texto);
    console.log('📝 Longitud:', texto?.length);
    console.log('========================================');
    
    try {
      let analisis = null;
      let metodo = 'desconocido';
      let textoCensurado = texto;
      
      // PASO 1: Intentar con Gemini
      try {
        const modelo = await obtenerModeloConFallback('FLASH');
        
        if (!modelo) {
          console.log('🔧 Gemini no disponible, saltando a censura manual');
          throw new Error('Gemini no disponible');
        }
        
        console.log('🤖 Usando Gemini para censura...');
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
              generationConfig: CONFIG_VALIDACION,
              safetySettings: SAFETY_SETTINGS
            });

            return extraerTextoRespuesta(respuesta);
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout Gemini')), TIMEOUTS.CENSURA)
          )
        ]);

        console.log('🔍 RESPUESTA BRUTA DE GEMINI:');
        console.log('-----------------------------------');
        console.log(resultado);
        console.log('-----------------------------------');

        analisis = extraerJSON(resultado);
        console.log('📊 ANÁLISIS GEMINI PARSEADO:', JSON.stringify(analisis, null, 2));
        
        // VALIDAR si Gemini realmente funcionó
        if (!analisis || analisis.error || analisis.nivel_censura === 'error') {
          console.warn('⚠️ Gemini retornó respuesta inválida o con error');
          console.warn('   Error detectado:', analisis?.error || 'estructura_invalida');
          throw new Error('Respuesta Gemini inválida');
        }
        
        // Si llegamos aquí, Gemini funcionó correctamente
        metodo = 'gemini';
        console.log('✅ Gemini funcionó correctamente');
        
      } catch (geminiError) {
        // PASO 2: Fallback a censura manual
        console.log('⚠️ Gemini falló, activando censura manual');
        console.log('   Razón:', geminiError.message);
        
        analisis = censurarManualmente(texto);
        metodo = 'manual_fallback';
        console.log('📊 ANÁLISIS MANUAL:', JSON.stringify(analisis, null, 2));
      }
      
      // PASO 3: Aplicar censura al texto
      if (analisis.palabras_censurar && analisis.palabras_censurar.length > 0) {
        console.log(`🔨 Censurando ${analisis.palabras_censurar.length} palabras...`);
        
        for (const item of analisis.palabras_censurar) {
          const palabra = item.palabra || item;
          if (!palabra || typeof palabra !== 'string') continue;
          
          const censura = '*'.repeat(palabra.length);
          const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
          
          const antes = textoCensurado;
          textoCensurado = textoCensurado.replace(regex, censura);
          
          if (antes !== textoCensurado) {
            console.log(`   ✓ "${palabra}" → "${censura}"`);
          } else {
            console.log(`   ⚠ "${palabra}" no encontrada en el texto`);
          }
        }
      } else {
        console.log('✅ No se encontraron palabras para censurar');
      }

      console.log('📝 Texto final:', textoCensurado);
      console.log('🎯 Método usado:', metodo);
      
      const resultado = {
        texto_censurado: textoCensurado,
        fue_censurado: analisis.palabras_censurar?.length > 0,
        nivel_censura: analisis.nivel_censura || 'ninguno',
        palabras_censuradas: analisis.palabras_censurar?.length || 0,
        requiere_revision: analisis.requiere_revision_humana || false,
        razon: metodo === 'gemini' ? 'Censura por IA' : 'Censura manual (fallback)',
        metodo
      };

      console.log('');
      console.log('========================================');
      console.log('📤 RETORNANDO RESULTADO:');
      console.log(JSON.stringify(resultado, null, 2));
      console.log('========================================');
      console.log('');
      
      return resultado;

    } catch (error) {
      console.error('❌ ERROR CRÍTICO EN CENSURA:', error.message);
      console.error('📍 Stack:', error.stack);
      
      // ÚLTIMO RESPALDO: Intentar censura manual de emergencia
      try {
        console.log('🆘 Intentando censura manual de emergencia...');
        const analisisEmergencia = censurarManualmente(texto);
        
        let textoCensurado = texto;
        if (analisisEmergencia.palabras_censurar?.length > 0) {
          for (const item of analisisEmergencia.palabras_censurar) {
            const palabra = item.palabra || item;
            if (palabra && typeof palabra === 'string') {
              const censura = '*'.repeat(palabra.length);
              const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
              textoCensurado = textoCensurado.replace(regex, censura);
            }
          }
        }
        
        console.log('✅ Censura de emergencia completada');
        
        return {
          texto_censurado: textoCensurado,
          fue_censurado: analisisEmergencia.palabras_censurar?.length > 0,
          nivel_censura: analisisEmergencia.nivel_censura || 'ninguno',
          palabras_censuradas: analisisEmergencia.palabras_censurar?.length || 0,
          requiere_revision: true,
          razon: 'Censura de emergencia tras error crítico',
          metodo: 'manual_emergencia'
        };
      } catch (errorEmergencia) {
        console.error('❌ Fallo total en censura de emergencia:', errorEmergencia.message);
        
        // ÚLTIMO ÚLTIMO RESPALDO: Marcar para revisión sin censurar
        return {
          texto_censurado: texto,
          fue_censurado: false,
          nivel_censura: 'error_critico',
          palabras_censuradas: 0,
          requiere_revision: true,
          razon: 'Fallo total del sistema de censura: ' + error.message,
          metodo: 'sin_censura'
        };
      }
    }
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