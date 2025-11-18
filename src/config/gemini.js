const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * ============================================
 * CONFIGURACIÓN DE GEMINI API - VERSIÓN MEJORADA
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
  FLASH: 'gemini-2.0-flash',
  PRO: 'gemini-2.0-pro',
  VISION: 'gemini-2.0-flash',
};

/**
 * Configuración de parámetros para generación de contenido
 */
const CONFIG_GENERACION = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 1024,
};

/**
 * Configuración específica para validación de contenido
 */
const CONFIG_VALIDACION = {
  temperature: 0.3,
  maxOutputTokens: 500,
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
  VALIDACION: 30000,
  IMAGEN: 45000,
  CENSURA: 20000,
  GENERAL: 30000,
};

/**
 * Prompts del sistema - VERSIÓN MEJORADA
 */
const PROMPTS = {
  VALIDACION_CONTENIDO: `
    Eres un moderador equilibrado para una red social universitaria.
    
    Esta es una plataforma donde estudiantes comparten:
    ✅ Contenido académico (tareas, proyectos, dudas)
    ✅ Vida estudiantil (eventos, actividades, campus)
    ✅ Experiencias personales (anécdotas, emociones, día a día)
    ✅ Opiniones y debates respetuosos
    ✅ Humor y memes apropiados
    
    CATEGORÍA: {categoria}
    CONTENIDO: "{contenido}"
    
    SOLO debes RECHAZAR contenido que sea CLARAMENTE:
    - Acoso, bullying o amenazas DIRECTAS contra personas específicas
    - Contenido sexual EXPLÍCITO (pornografía, desnudos)
    - Violencia gráfica o llamados a la violencia
    - Discriminación SEVERA y odio dirigido a grupos
    - Spam comercial excesivo o estafas
    - Compartir información personal de otros sin consentimiento
    
    ⚠️ NO rechaces contenido por:
    - Lenguaje coloquial o jerga juvenil
    - Desahogos emocionales o frustraciones personales
    - Opiniones fuertes expresadas respetuosamente
    - Humor negro o sarcasmo que no ataque a personas
    - Quejas sobre situaciones personales o académicas
    - Referencias moderadas a temas adultos en contexto apropiado
    
    🎯 CONTEXTO ES CLAVE: Considera la INTENCIÓN, no solo las palabras.
    
    Responde ÚNICAMENTE en formato JSON sin explicaciones adicionales:
    {
      "aprobado": boolean,
      "razon": "string (si no está aprobado)",
      "confianza": número (0-100),
      "categorias_detectadas": [array de problemas graves encontrados],
      "accion_recomendada": "publico|requiere_revision|rechazar"
    }
  `,

  VALIDACION_IMAGEN: `
    Eres un moderador equilibrado para una red social universitaria.
    
    Los estudiantes comparten fotos de:
    ✅ Eventos universitarios, campus, actividades
    ✅ Proyectos, tareas, trabajos académicos
    ✅ Momentos cotidianos, amigos, celebraciones
    ✅ Memes, capturas de pantalla, contenido humorístico
    
    Contenido de la publicación: "{contenido}"
    
    SOLO rechaza imágenes con:
    - Desnudez o contenido sexual explícito
    - Violencia gráfica o gore
    - Símbolos de odio o supremacismo
    - Información personal sensible claramente visible
    
    ⚠️ NO rechaces por:
    - Fiestas o reuniones sociales normales
    - Ropa casual, trajes de baño en contexto apropiado (playa, alberca)
    - Alcohol en contexto social adulto (sin promover excesos)
    - Selfies, fotos grupales, fotos cotidianas
    
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
    Eres un moderador equilibrado para una plataforma universitaria.
    Tu trabajo es identificar palabras OFENSIVAS o AGRESIVAS que afecten el respeto mutuo.

    COMENTARIO A ANALIZAR:
    "{comentario}"

    🎯 PRINCIPIO: Permite expresión libre, pero mantén un ambiente respetuoso.

    CATEGORÍAS A CENSURAR:
    
    1. 🤬 GROSERÍAS OFENSIVAS:
       ❌ Insultos directos a personas: "eres un pendejo", "estúpido", "idiota"
       ❌ Agresiones hostiles: "vete a la mierda", "me caga [persona]"
       ❌ Insultos a organizaciones/empresas: "cagada de empresa", "empresa de mierda"
       ❌ Desprecio agresivo: "pinche [persona/empresa]" en tono negativo
       
    2. 🔞 CONTENIDO SEXUAL EXPLÍCITO:
       ❌ Términos pornográficos o actos sexuales explícitos
       ❌ Acoso sexual o comentarios sexuales no solicitados
       
    3. ⚔️ AMENAZAS:
       ❌ Amenazas directas: "te voy a matar", "voy por ti"
       
    4. 💔 DISCURSO DE ODIO:
       ❌ Insultos raciales, homofóbicos, xenófobos usados como arma

    ✅ NO CENSURES (expresión cotidiana):
    
    - Desahogos sin objetivo: "qué pinche día", "estoy hasta la madre"
    - Jerga amistosa: "qué pedo", "no mames" (sin agresión)
    - Frustración general: "esta situación es una mierda" (sin mencionar personas/empresas)
    - Humor entre amigos: "no seas mamón jaja"
    - Énfasis emocional: "estoy bien jodido con los exámenes"
    - Referencias abstractas: "el tráfico está de la chingada"
    
    ⚠️ REGLA CLAVE - OBJETIVO IDENTIFICABLE:
    Si hay un objetivo claro (persona, empresa, grupo específico) + lenguaje ofensivo = CENSURAR
    
    📚 EJEMPLOS:
    
    ✅ PERMITIDO:
    "No mames, olvidé la tarea 😭"
    "Estoy hasta la madre de tanto estudio"
    "Esta situación es una mierda"
    "Pinche tráfico, llegué tarde"
    
    ❌ CENSURAR:
    "Eres un pendejo" (insulto a persona)
    "Cagada de empresa" (insulto a organización)
    "Empresa de mierda" (desprecio a entidad)
    "Vete a la verga idiota" (agresión directa)
    "Pinche [nombre], no sirve" (desprecio con objetivo)
    "Te voy a romper la madre" (amenaza)

    🔍 CRITERIO DE DECISIÓN:
    1. ¿Hay un objetivo identificable? (persona, empresa, grupo)
    2. ¿El lenguaje es despectivo/ofensivo hacia ese objetivo?
    3. Si ambos = SÍ → CENSURAR
    4. Si es expresión general sin objetivo → PERMITIR

    Responde ÚNICAMENTE en formato JSON sin markdown:
    {
      "palabras_censurar": [
        {
          "palabra": "palabra_exacta_encontrada",
          "categoria": "insulto_directo|insulto_organizacion|sexual|amenaza|odio",
          "contexto": "breve razón de por qué se censura"
        }
      ],
      "nivel_censura": "ninguno|bajo|medio|alto",
      "requiere_revision_humana": true/false,
      "razon": "breve explicación solo si requiere revisión"
    }

    NIVELES:
    - "ninguno": expresión cotidiana sin objetivo ofensivo
    - "bajo": 1-2 palabras censuradas (lenguaje fuerte con objetivo)
    - "medio": 3-5 palabras o insulto directo claro
    - "alto": amenazas, acoso o múltiples agresiones
    
    ⚡ Si menciona persona/empresa específica + palabra ofensiva = CENSURAR
  `,
};

/**
 * Obtener modelo de Gemini
 */
function obtenerModelo(tipoModelo = 'FLASH') {
  const nombreModelo = MODELOS[tipoModelo] || MODELOS.FLASH;
  console.log(`🤖 Usando modelo: ${nombreModelo}`);
  return genAI.getGenerativeModel({ model: nombreModelo });
}

/**
 * Ejecutar solicitud a Gemini con reintentos
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
      
      const espera = Math.pow(2, intento) * 1000;
      console.log(`⏳ Esperando ${espera}ms antes de reintentar...`);
      await new Promise(resolve => setTimeout(resolve, espera));
    }
  }
}

/**
 * Extraer JSON de respuesta
 */
function extraerJSON(texto) {
  let jsonStr = texto.trim();
  jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No se pudo extraer JSON de la respuesta');
  }
  
  return JSON.parse(jsonMatch[0]);
}

/**
 * Reemplazar variables en prompt
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
    console.log(`📊 Modelo activo: gemini-2.0-flash (modo mejorado)`);
    console.log(`🔑 API Key: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`🎯 Modo: EQUILIBRADO con censura de insultos a entidades`);
    
  } catch (error) {
    console.error('❌ Error al verificar Gemini:', error.message);
    console.log('⚠️ La censura funcionará en modo fallback');
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