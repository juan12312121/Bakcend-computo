const {
  obtenerModelo,
  ejecutarConReintentos,
  extraerJSON,
  formatearPrompt,
  CONFIG_VALIDACION,
  CONFIG_IMAGEN,
  TIMEOUTS,
  PROMPTS,
} = require('../config/gemini');

class CensuraPublicaciones {
  
  /**
   * Validar contenido de texto con Gemini
   * @param {string} contenido - Texto a validar
   * @param {string} categoria - Categoría de la publicación
   * @returns {Promise<object>}
   */
  static async validarContenido(contenido, categoria = 'General') {
    try {
      console.log('🔍 Iniciando validación de contenido...');
      
      const modelo = obtenerModelo('FLASH');
      const prompt = formatearPrompt(PROMPTS.VALIDACION_CONTENIDO, {
        categoria,
        contenido: contenido.substring(0, 1000),
      });

      const resultado = await ejecutarConReintentos(async () => {
        const result = await Promise.race([
          modelo.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: CONFIG_VALIDACION,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout en validación')), TIMEOUTS.VALIDACION)
          ),
        ]);
        return result;
      });

      const responseText = resultado.response.text();
      const analisis = extraerJSON(responseText);

      console.log(`✅ Validación completada - Aprobado: ${analisis.aprobado}`);

      return {
        valido: analisis.aprobado,
        razon: analisis.razon || 'Contenido aprobado',
        confianza: analisis.confianza || 0,
        problemas: analisis.categorias_detectadas || [],
        accion: analisis.accion_recomendada || 'publico',
        timestamp: new Date(),
      };

    } catch (error) {
      console.error('❌ Error en validación de contenido:', error.message);
      
      return {
        valido: true,
        razon: `Error en validación (${error.message}) - contenido permitido por defecto`,
        confianza: 0,
        problemas: [],
        accion: 'error',
        timestamp: new Date(),
        error: error.message,
      };
    }
  }

  /**
   * Validar imagen con Gemini
   * @param {string} imagenUrl - URL de la imagen en S3
   * @param {string} contenidoRelacionado - Contenido de la publicación
   * @returns {Promise<object>}
   */
  static async validarImagenDescripcion(imagenUrl, contenidoRelacionado = '') {
    try {
      console.log('🖼️ Iniciando validación de imagen...');
      
      const modelo = obtenerModelo('VISION');
      const prompt = formatearPrompt(PROMPTS.VALIDACION_IMAGEN, {
        contenido: contenidoRelacionado.substring(0, 500),
      });

      const imagenBase64 = await this.obtenerImagenBase64(imagenUrl);

      const resultado = await ejecutarConReintentos(async () => {
        const result = await Promise.race([
          modelo.generateContent({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: imagenBase64,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: CONFIG_IMAGEN,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout en validación de imagen')), TIMEOUTS.IMAGEN)
          ),
        ]);
        return result;
      });

      const responseText = resultado.response.text();
      const analisis = extraerJSON(responseText);

      console.log(`✅ Validación de imagen completada - Apropiada: ${analisis.apropiada}`);

      return {
        apropiada: analisis.apropiada,
        razon: analisis.razon || 'Imagen aprobada',
        confianza: analisis.confianza || 0,
        problemas: analisis.problemas || [],
        accion: analisis.accion || 'publico',
        timestamp: new Date(),
      };

    } catch (error) {
      console.error('❌ Error validando imagen:', error.message);
      
      return {
        apropiada: true,
        razon: `Error en validación de imagen (${error.message})`,
        confianza: 0,
        problemas: [],
        accion: 'error',
        timestamp: new Date(),
        error: error.message,
      };
    }
  }

  /**
   * Convertir URL de imagen a base64
   * @param {string} url - URL de la imagen
   * @returns {Promise<string>}
   */
  static async obtenerImagenBase64(url) {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(url);
      const buffer = await response.buffer();
      return buffer.toString('base64');
    } catch (error) {
      console.error('❌ Error obteniendo imagen:', error.message);
      throw error;
    }
  }

  /**
   * Generar reporte completo de análisis
   * @param {number} publicacionId - ID de la publicación
   * @param {number} userId - ID del usuario
   * @param {object} analisisContenido - Resultado de validación de contenido
   * @param {object} analisisImagen - Resultado de validación de imagen
   * @returns {object} Reporte completo
   */
  static async generarReporte(publicacionId, userId, analisisContenido, analisisImagen = null) {
    const reporte = {
      publicacionId,
      userId,
      fecha: new Date().toISOString(),
      contenido: {
        valido: analisisContenido.valido,
        razon: analisisContenido.razon,
        confianza: analisisContenido.confianza,
        problemas: analisisContenido.problemas,
        accion: analisisContenido.accion,
      },
      imagen: analisisImagen
        ? {
            apropiada: analisisImagen.apropiada,
            razon: analisisImagen.razon,
            confianza: analisisImagen.confianza,
            accion: analisisImagen.accion,
          }
        : null,
      estadoFinal: this.determinarEstadoFinal(analisisContenido, analisisImagen),
    };

    console.log('📋 Reporte generado:', reporte.estadoFinal.estado);
    return reporte;
  }

  /**
   * Determinar el estado final de la publicación
   * @param {object} analisisContenido - Análisis del contenido
   * @param {object} analisisImagen - Análisis de la imagen
   * @returns {object} Estado final
   */
  static determinarEstadoFinal(analisisContenido, analisisImagen) {
    // Si hay error en Gemini, permitir por defecto
    if (analisisContenido.accion === 'error' || analisisImagen?.accion === 'error') {
      return {
        estado: 'APROBADO',
        razon: 'Validación con error - contenido permitido',
        nivel: 'bajo',
        confianza: 'baja',
      };
    }

    // Si el contenido no es válido
    if (!analisisContenido.valido || analisisContenido.accion === 'rechazar') {
      return {
        estado: 'RECHAZADO',
        razon: analisisContenido.razon,
        nivel: 'alto',
        confianza: `${analisisContenido.confianza}%`,
      };
    }

    // Si la imagen no es apropiada
    if (analisisImagen && (!analisisImagen.apropiada || analisisImagen.accion === 'rechazar')) {
      return {
        estado: 'RECHAZADO',
        razon: analisisImagen.razon,
        nivel: 'alto',
        confianza: `${analisisImagen.confianza}%`,
      };
    }

    // Si hay baja confianza o requiere revisión
    if (
      analisisContenido.confianza < 70 ||
      analisisContenido.accion === 'requiere_revision' ||
      (analisisImagen && analisisImagen.confianza < 70)
    ) {
      return {
        estado: 'REQUIERE_REVISION',
        razon: 'Moderador humano debe revisar (baja confianza)',
        nivel: 'medio',
        confianza: Math.min(
          analisisContenido.confianza,
          analisisImagen?.confianza || 100
        ),
      };
    }

    // Aprobado
    return {
      estado: 'APROBADO',
      razon: 'Contenido e imagen apropiados',
      nivel: 'bajo',
      confianza: Math.min(
        analisisContenido.confianza,
        analisisImagen?.confianza || 100
      ),
    };
  }
}

module.exports = CensuraPublicaciones;