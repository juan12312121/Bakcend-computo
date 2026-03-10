/**
 * ============================================
 * SERVICIO DE CENSURA - VERSIÓN CON IA (GEMINI)
 * ============================================
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class CensuraPublicaciones {

  /**
   * 🔍 Validar contenido de texto
   */
  static async validarContenido(contenido, categoria = 'General') {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY no configurada. Saltando censura.');
      return this.fallbackAprobar();
    }

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const prompt = `
        Analiza el siguiente contenido para una red social estudiantil.
        Categoría: ${categoria}
        Contenido: "${contenido}"
        
        Responde estrictamente en formato JSON con la siguiente estructura:
        {
          "valido": boolean,
          "apropiado": boolean,
          "accion": "aprobar" | "rechazar" | "moderar",
          "razon": "string breve en español",
          "problemas": ["lista de problemas si los hay"]
        }
        
        Criterios de rechazo: Odio, violencia explícita, acoso, contenido sexual, spam o contenido ilegal.
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      // Limpiar markdown del JSON si existe
      text = text.replace(/```json|```/g, '').trim();

      const analysis = JSON.parse(text);
      return {
        ...analysis,
        confianza: 100,
        metodo: 'gemini-ai'
      };
    } catch (error) {
      console.error('❌ Error en censura de texto (Gemini):', error);
      return this.fallbackAprobar('Error en validación AI');
    }
  }

  /**
   * 🖼️ Validar imagen
   */
  static async validarImagenDescripcion(imagenPath, contenidoRelacionado = '') {
    if (!process.env.GEMINI_API_KEY) return this.fallbackAprobar();
    if (!fs.existsSync(imagenPath)) return this.fallbackAprobar('Imagen no encontrada');

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const imageParts = [
        {
          inlineData: {
            data: Buffer.from(fs.readFileSync(imagenPath)).toString("base64"),
            mimeType: "image/jpeg",
          },
        },
      ];

      const prompt = `
        Analiza esta imagen y su descripción: "${contenidoRelacionado}"
        ¿Es apropiada para una red social universitaria?
        Busca: Desnudez, violencia, drogas, armas o contenido ofensivo.
        
        Responde estrictamente en formato JSON:
        {
          "apropiada": boolean,
          "accion": "aprobar" | "rechazar",
          "razon": "string breve en español",
          "problemas": []
        }
      `;

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      let text = response.text();

      text = text.replace(/```json|```/g, '').trim();

      const analysis = JSON.parse(text);
      return {
        ...analysis,
        valido: analysis.apropiada,
        confianza: 100,
        metodo: 'gemini-vision'
      };
    } catch (error) {
      console.error('❌ Error en censura de imagen (Gemini):', error);
      return this.fallbackAprobar('Error en validación AI (Imagen)');
    }
  }

  /**
   * 📋 Generar reporte completo
   */
  static async generarReporte(publicacionId, userId, analisisContenido, analisisImagen = null) {
    const esApropiado = analisisContenido.apropiado && (!analisisImagen || analisisImagen.apropiada);

    return {
      publicacionId,
      userId,
      fecha: new Date().toISOString(),
      contenido: analisisContenido,
      imagen: analisisImagen,
      estadoFinal: {
        estado: esApropiado ? 'APROBADO' : 'RECHAZADO',
        razon: esApropiado ? 'Aprobado por IA' : 'Rechazado por incumplir políticas',
        nivel: esApropiado ? 'bajo' : 'alto',
        confianza: 100
      }
    };
  }

  static fallbackAprobar(razon = 'Aprobado (Fallback)') {
    return {
      valido: true,
      apropiado: true,
      accion: 'aprobar',
      razon,
      confianza: 0,
      problemas: [],
      metodo: 'local-fallback'
    };
  }
}

module.exports = CensuraPublicaciones;