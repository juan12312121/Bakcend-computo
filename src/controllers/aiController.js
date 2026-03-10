// src/controllers/aiController.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * 🤖 Handle AI Assistant requests
 */
exports.preguntarAsistente = async (req, res) => {
    try {
        const { mensaje, contexto } = req.body;

        if (!mensaje) {
            return errorResponse(res, 'El mensaje es requerido', 400);
        }

        if (!process.env.GEMINI_API_KEY) {
            return errorResponse(res, 'Servicio de IA no configurado', 500);
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Usar gemini-1.5-flash que es más compatible con llaves gratuitas
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
      Eres TRINO, un asistente de IA experto para una red social estudiantil universitaria.
      Tu objetivo es ayudar a los estudiantes con dudas académicas, consejos de estudio y navegación en la plataforma.
      
      Reglas:
      1. Sé amable, profesional y motivador.
      2. No respondas contenido inapropiado o violento.
      3. Si te preguntan algo fuera del ámbito académico o de la plataforma, intenta reenfocar la conversación amablemente.
      4. Tus respuestas deben ser concisas pero útiles.
      
      Mensaje del usuario: "${mensaje}"
      Contexto opcional (ej. carrera del usuario): "${contexto || 'No proporcionado'}"
    `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        return successResponse(res, { respuesta: responseText }, 'IA ha respondido');
    } catch (error) {
        console.error('❌ ERROR DETALLADO EN AI ASSISTANT:', error);

        // Error específico para el frontend si la cuota excedió o la llave es inválida
        const mensajeError = error.message?.includes('API_KEY_INVALID') ? 'Llave de API inválida' :
            error.message?.includes('quota') ? 'Cuota de IA excedida' :
                'Error al procesar la petición de IA';

        return errorResponse(res, mensajeError, 500);
    }
};
