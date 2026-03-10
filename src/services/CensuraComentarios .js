const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY no está definida en .env');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MODELOS_DISPONIBLES = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];

const MODELOS = {
  FLASH: null,
  PRO: null,
  VISION: null,
};

let modeloActualIndex = 0;
let modeloEnUso = null;
let usarCensuraManual = false;

const CONFIG_GENERACION = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 1024,
};

const CONFIG_VALIDACION = {
  temperature: 0.3,
  maxOutputTokens: 500,
};

const CONFIG_IMAGEN = {
  temperature: 0.3,
  maxOutputTokens: 500,
};

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

const TIMEOUTS = {
  VALIDACION: 30000,
  IMAGEN: 45000,
  CENSURA: 20000,
  GENERAL: 30000,
};

// ✅ CENSURA DESACTIVADA - Acepta todo
const PALABRAS_PROHIBIDAS = {
  insultos: [],
  permitidas: []
};

// ✅ CENSURA MANUAL DESACTIVADA - Siempre aprueba
function censurarManualmente(texto) {
  return {
    palabras_censurar: [],
    nivel_censura: 'ninguno',
    requiere_revision_humana: false,
    metodo: 'manual',
    texto_censurado: texto
  };
}

const PROMPTS = {
  // ✅ Siempre aprueba todo
  VALIDACION_CONTENIDO: `
    Responde ÚNICAMENTE en formato JSON sin explicaciones adicionales:
    {
      "aprobado": true,
      "razon": "",
      "confianza": 100,
      "categorias_detectadas": [],
      "accion_recomendada": "publico"
    }
  `,

  // ✅ Siempre aprueba imágenes
  VALIDACION_IMAGEN: `
    Responde en JSON:
    {
      "apropiada": true,
      "razon": "",
      "confianza": 100,
      "problemas": [],
      "accion": "publico"
    }
  `,

  // ✅ Nunca censura comentarios
  CENSURA_COMENTARIO: `
    Responde SOLO en formato JSON:
    {
      "palabras_censurar": [],
      "nivel_censura": "ninguno",
      "requiere_revision_humana": false
    }
  `
};

async function obtenerModeloConFallback(tipoModelo = 'FLASH') {
  if (usarCensuraManual) {
    console.log('🔧 Usando censura manual (Gemini no disponible)');
    return null;
  }

  if (!genAI) {
    console.log('⚠️ No hay API key de Gemini, usando censura manual');
    usarCensuraManual = true;
    return null;
  }

  if (modeloEnUso) {
    console.log(`♻️  Usando modelo: ${modeloEnUso}`);
    return genAI.getGenerativeModel({ model: modeloEnUso });
  }

  for (let i = modeloActualIndex; i < MODELOS_DISPONIBLES.length; i++) {
    const nombreModelo = MODELOS_DISPONIBLES[i];
    try {
      console.log(`🔄 Probando modelo ${i + 1}/${MODELOS_DISPONIBLES.length}: ${nombreModelo}...`);
      const modelo = genAI.getGenerativeModel({ model: nombreModelo });
      const resultado = await modelo.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Di "OK"' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 },
        safetySettings: SAFETY_SETTINGS
      });
      const texto = extraerTextoRespuesta(resultado);
      if (texto && texto.trim().length > 0) {
        console.log(`✅ ¡Modelo ${nombreModelo} FUNCIONA!`);
        modeloEnUso = nombreModelo;
        modeloActualIndex = i;
        MODELOS.FLASH = nombreModelo;
        MODELOS.PRO = nombreModelo;
        MODELOS.VISION = nombreModelo;
        return modelo;
      }
    } catch (error) {
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`⚠️ Cuota agotada en ${nombreModelo}, cambiando a censura manual`);
        usarCensuraManual = true;
        return null;
      }
      console.log(`❌ Modelo ${nombreModelo} no disponible`);
      continue;
    }
  }

  console.log('⚠️ Ningún modelo de Gemini disponible, usando censura manual');
  usarCensuraManual = true;
  return null;
}

function obtenerModelo(tipoModelo = 'FLASH') {
  if (usarCensuraManual || !genAI) return null;
  const nombreModelo = modeloEnUso || MODELOS_DISPONIBLES[0];
  console.log(`🤖 Usando modelo: ${nombreModelo}`);
  return genAI.getGenerativeModel({ model: nombreModelo });
}

async function ejecutarConReintentos(fn, reintentos = 3, cambiarModeloEnError = true) {
  for (let intento = 0; intento < reintentos; intento++) {
    try {
      return await fn();
    } catch (error) {
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.warn(`⚠️ Cuota agotada, cambiando a censura manual`);
        usarCensuraManual = true;
        throw error;
      }
      if (cambiarModeloEnError && intento === reintentos - 1 && modeloActualIndex < MODELOS_DISPONIBLES.length - 1) {
        console.log(`🔄 Intentando con siguiente modelo...`);
        modeloActualIndex++;
        modeloEnUso = null;
        return await ejecutarConReintentos(fn, 2, false);
      }
      if (intento === reintentos - 1) throw error;
      const espera = Math.pow(2, intento) * 1000;
      await new Promise(resolve => setTimeout(resolve, espera));
    }
  }
}

function extraerTextoRespuesta(resultado) {
  try {
    if (resultado?.response && typeof resultado.response.text === 'function') {
      return resultado.response.text();
    }
    if (resultado?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return resultado.response.candidates[0].content.parts[0].text;
    }
    if (resultado?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return resultado.candidates[0].content.parts[0].text;
    }
    return '';
  } catch (error) {
    console.error('❌ Error al extraer texto:', error.message);
    return '';
  }
}

function extraerJSON(texto) {
  if (!texto || texto.trim().length === 0) {
    return {
      palabras_censurar: [],
      nivel_censura: 'ninguno',
      requiere_revision_humana: false,
      error: 'respuesta_vacia'
    };
  }
  try {
    let jsonStr = texto.trim();
    jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        palabras_censurar: [],
        nivel_censura: 'ninguno',
        requiere_revision_humana: false,
        error: 'json_no_encontrado'
      };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.hasOwnProperty('palabras_censurar')) {
      return {
        palabras_censurar: [],
        nivel_censura: 'ninguno',
        requiere_revision_humana: false,
        error: 'estructura_invalida'
      };
    }
    return parsed;
  } catch (error) {
    return {
      palabras_censurar: [],
      nivel_censura: 'ninguno',
      requiere_revision_humana: false,
      error: 'parse_error'
    };
  }
}

function formatearPrompt(prompt, variables = {}) {
  let resultado = prompt;
  for (const [clave, valor] of Object.entries(variables)) {
    resultado = resultado.replace(`{${clave}}`, valor);
  }
  return resultado;
}

async function verificarGemini() {
  try {
    console.log('========================================');
    console.log('🤖 VERIFICANDO GEMINI API');
    console.log('========================================');
    console.log(`🔑 API Key: ${process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ No configurada'}`);
    console.log(`📋 Modelos a probar: ${MODELOS_DISPONIBLES.length}`);

    if (!genAI) {
      console.log('⚠️ Sin API key, activando censura manual');
      usarCensuraManual = true;
      return;
    }

    const modelo = await obtenerModeloConFallback('FLASH');

    if (modelo) {
      console.log('========================================');
      console.log(`✅ GEMINI CONECTADO: ${modeloEnUso}`);
      console.log(`🎯 Modo: IA + Manual de Censura (alternativa)`);
      console.log('========================================');
    } else {
      console.log('========================================');
      console.log('⚠️ MODO: CENSURA MANUAL ÚNICAMENTE');
      console.log('========================================');
    }
  } catch (error) {
    console.error('❌ Error verificando Gemini:', error.message);
    usarCensuraManual = true;
  }
}

verificarGemini();

module.exports = {
  genAI,
  MODELOS,
  MODELOS_DISPONIBLES,
  CONFIG_GENERACION,
  CONFIG_VALIDACION,
  CONFIG_IMAGEN,
  SAFETY_SETTINGS,
  TIMEOUTS,
  PROMPTS,
  obtenerModelo,
  obtenerModeloConFallback,
  ejecutarConReintentos,
  extraerJSON,
  extraerTextoRespuesta,
  formatearPrompt,
  censurarManualmente,
  get usarCensuraManual() {
    return usarCensuraManual;
  },
  PALABRAS_PROHIBIDAS,
};