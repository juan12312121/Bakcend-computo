const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * ============================================
 * CONFIGURACIÓN DE GEMINI API
 * ============================================
 * Archivo: config/gemini.js
 */

// Validar que la API key esté configurada
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY no está definida en .env');
  process.exit(1);
}

// Inicializar cliente de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Configuración de modelos disponibles
 */
const MODELOS = {
  FLASH: 'gemini-2.0-flash',           // ✅ Modelo rápido y eficiente
  PRO: 'gemini-2.0-pro',               // ✅ Modelo más potente
  VISION: 'gemini-2.0-flash',          // ✅ Análisis de imágenes
};

/**
 * Configuración de parámetros para generación de contenido
 */
const CONFIG_GENERACION = {
  temperature: 0.7,           // 0-1: Creatividad (0=determinista, 1=creativo)
  topK: 40,                   // Top K sampling
  topP: 0.95,                 // Top P (nucleus) sampling
  maxOutputTokens: 1024,      // Máximo de tokens en la respuesta
};

/**
 * Configuración específica para validación de contenido
 */
const CONFIG_VALIDACION = {
  temperature: 0.2,           // Bajo: respuestas más consistentes
  maxOutputTokens: 500,       // No necesita respuesta larga
};

/**
 * Configuración específica para análisis de imágenes
 */
const CONFIG_IMAGEN = {
  temperature: 0.3,
  maxOutputTokens: 500,
};

/**
 * Tiempos de espera (en ms)
 */
const TIMEOUTS = {
  VALIDACION: 30000,          // 30 segundos para validación
  IMAGEN: 45000,              // 45 segundos para imágenes
  CENSURA: 20000,             // 20 segundos para censura de comentarios
  GENERAL: 30000,             // General
};

/**
 * Prompts del sistema
 */
const PROMPTS = {
  VALIDACION_CONTENIDO: `
    Eres un moderador de contenido para una plataforma escolar universitaria.
    
    Analiza el siguiente contenido y determina si es apropiado para una plataforma educativa.
    
    CATEGORÍA: {categoria}
    CONTENIDO: "{contenido}"
    
    Debes verificar si el contenido contiene:
    - Lenguaje ofensivo, insultos o bullying
    - Contenido sexual o explícito
    - Violencia o amenazas
    - Discriminación (por género, raza, religión, orientación sexual, etc.)
    - Spam o contenido comercial inapropiado
    - Links o solicitudes de datos personales
    - Plagio o suplantación de identidad
    - Contenido que viole derechos de autor
    
    Responde ÚNICAMENTE en formato JSON sin explicaciones adicionales:
    {
      "aprobado": boolean,
      "razon": "string (si no está aprobado)",
      "confianza": número (0-100),
      "categorias_detectadas": [array de problemas encontrados],
      "accion_recomendada": "publico|requiere_revision|rechazar"
    }
  `,

  VALIDACION_IMAGEN: `
    Eres un moderador de contenido para una plataforma escolar universitaria.
    
    Analiza esta imagen en el contexto de una publicación educativa.
    Contenido de la publicación: "{contenido}"
    
    Verifica si la imagen es apropiada detectando:
    - Contenido violento o gráfico
    - Contenido sexual o explícito
    - Imágenes que violen privacidad
    - Contenido que promueva drogas, alcohol o actividades ilegales
    - Comportamiento acosador o discriminatorio
    - Watermarks o marcas de agua sospechosas
    
    Responde en JSON:
    {
      "apropiada": boolean,
      "razon": "string",
      "confianza": número (0-100),
      "problemas": [array],
      "accion": "publico|requiere_revision|rechazar"
    }
  `,

  CENSURA_COMENTARIO: `
    Eres un moderador de contenido para una plataforma universitaria.
    Tu trabajo es identificar palabras inapropiadas en comentarios para censurarlas con asteriscos.

    COMENTARIO A ANALIZAR:
    "{comentario}"

    CATEGORÍAS A IDENTIFICAR:
    1. 🤬 Palabras soeces y groserías (fuck, shit, mierda, puto, pendejo, cabrón, verga, etc.)
    2. 😡 Insultos directos o indirectos (idiota, imbécil, estúpido, retrasado, etc.)
    3. 🔞 Contenido sexual explícito (sexo, pene, vagina, coger, follar, tetas, culo, porno, etc.)
    4. ⚔️ Amenazas o violencia (matar, morir, golpear, asesinar, arma, sangre, etc.)
    5. 💔 Discurso de odio (insultos raciales, homofóbicos, xenófobos, etc.)

    REGLAS IMPORTANTES:
    - NO censures palabras en contexto educativo legítimo (ej: "La discriminación sexual es un problema")
    - NO censures palabras médicas o científicas apropiadas
    - NO censures palabras similares pero inocentes (ej: "sexto" NO es "sexo")
    - SÍ censura variaciones y plurales (puto/puta/putos/putas)
    - SÍ censura palabras con símbolos que intentan evadir filtros (p3nd3jo, c@brón)
    - Considera el CONTEXTO completo del mensaje

    EJEMPLOS:
    ✅ "Eres un pendejo" → censurar "pendejo" (insulto directo)
    ✅ "Vete a la mierda" → censurar "mierda" (grosería)
    ✅ "Te voy a matar" → censurar "matar" (amenaza)
    ❌ "El sexto semestre" → NO censurar (contexto educativo)
    ❌ "Discriminación sexual" → NO censurar (término académico)

    Responde ÚNICAMENTE en formato JSON sin markdown ni explicaciones:
    {
      "palabras_censurar": [
        {
          "palabra": "palabra_exacta_encontrada",
          "categoria": "soez|insulto|sexual|amenaza|odio"
        }
      ],
      "nivel_censura": "ninguno|bajo|medio|alto",
      "requiere_revision_humana": true/false,
      "razon": "breve explicación solo si requiere revisión humana"
    }

    NOTAS:
    - "ninguno": 0 palabras censuradas
    - "bajo": 1-2 palabras censuradas
    - "medio": 3-5 palabras censuradas
    - "alto": 6+ palabras o amenazas serias
    - requiere_revision_humana: true si hay amenazas graves o contexto ambiguo
  `,
};

/**
 * Obtener modelo de Gemini
 * @param {string} tipoModelo - FLASH, PRO, VISION
 * @returns {object} Instancia del modelo
 */
function obtenerModelo(tipoModelo = 'FLASH') {
  const nombreModelo = MODELOS[tipoModelo] || MODELOS.FLASH;
  console.log(`🤖 Usando modelo: ${nombreModelo}`);
  return genAI.getGenerativeModel({ model: nombreModelo });
}

/**
 * Ejecutar solicitud a Gemini con reintentos
 * @param {function} fn - Función a ejecutar
 * @param {number} reintentos - Número de reintentos
 * @returns {Promise}
 */
async function ejecutarConReintentos(fn, reintentos = 3) {
  for (let intento = 0; intento < reintentos; intento++) {
    try {
      return await fn();
    } catch (error) {
      console.warn(`⚠️ Intento ${intento + 1}/${reintentos} falló:`, error.message);
      
      if (intento === reintentos - 1) {
        throw error;
      }
      
      // Esperar antes de reintentar (backoff exponencial)
      const espera = Math.pow(2, intento) * 1000;
      console.log(`⏳ Esperando ${espera}ms antes de reintentar...`);
      await new Promise(resolve => setTimeout(resolve, espera));
    }
  }
}

/**
 * Extraer JSON de respuesta
 * @param {string} texto - Texto de respuesta
 * @returns {object} JSON parseado
 */
function extraerJSON(texto) {
  // Intentar extraer JSON limpio
  let jsonStr = texto.trim();
  
  // Remover markdown si existe
  jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  
  // Buscar el JSON entre llaves
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No se pudo extraer JSON de la respuesta');
  }
  
  return JSON.parse(jsonMatch[0]);
}

/**
 * Reemplazar variables en prompt
 * @param {string} prompt - Prompt con placeholders
 * @param {object} variables - Variables a reemplazar
 * @returns {string}
 */
function formatearPrompt(prompt, variables = {}) {
  let resultado = prompt;
  for (const [clave, valor] of Object.entries(variables)) {
    resultado = resultado.replace(`{${clave}}`, valor);
  }
  return resultado;
}

/**
 * Verificar conexión con Gemini
 */
async function verificarGemini() {
  try {
    console.log('🤖 Verificando conexión con Gemini...');
    const modelo = obtenerModelo('FLASH');
    
    const resultado = await modelo.generateContent({
      contents: [{ 
        role: 'user', 
        parts: [{ text: 'Responde OK' }] 
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 10
      }
    });
    
    const respuesta = resultado.response.text();
    console.log(`✅ Gemini conectado correctamente. Respuesta: "${respuesta.trim()}"`);
    console.log(`📊 Modelo activo: gemini-2.0-flash`);
    console.log(`🔑 API Key: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
    
  } catch (error) {
    console.error('❌ Error al verificar Gemini:', error.message);
    console.log('⚠️ La censura funcionará en modo fallback (contenido permitido por defecto)');
  }
}

// Ejecutar verificación al cargar el módulo
verificarGemini();

module.exports = {
  genAI,
  MODELOS,
  CONFIG_GENERACION,
  CONFIG_VALIDACION,
  CONFIG_IMAGEN,
  TIMEOUTS,
  PROMPTS,
  obtenerModelo,
  ejecutarConReintentos,
  extraerJSON,
  formatearPrompt,
};