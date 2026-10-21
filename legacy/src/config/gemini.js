const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * ============================================
 * CONFIGURACIÓN DE GEMINI API - VERSIÓN CORREGIDA
 * ============================================
 */

if (!process.env.GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY no está definida en .env');
  console.log('⚠️ La censura funcionará en modo fallback');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * 🎯 MODELOS DISPONIBLES - Nomenclatura correcta para API v1
 */
const MODELOS_DISPONIBLES = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
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
  {
    category: "HARM_CATEGORY_HARASSMENT",
    threshold: "BLOCK_NONE"
  },
  {
    category: "HARM_CATEGORY_HATE_SPEECH",
    threshold: "BLOCK_NONE"
  },
  {
    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    threshold: "BLOCK_NONE"
  },
  {
    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
    threshold: "BLOCK_NONE"
  }
];

const TIMEOUTS = {
  VALIDACION: 30000,
  IMAGEN: 45000,
  CENSURA: 20000,
  GENERAL: 30000,
};

/**
 * 🚨 SISTEMA DE CENSURA MANUAL (RESPALDO) - MEJORADO
 */
const PALABRAS_PROHIBIDAS = {
  insultos: [
    // Insultos personales directos
    'pendejo', 'pendeja', 'pendejos', 'pendejas',
    'idiota', 'idiotas',
    'estúpido', 'estúpida', 'estúpidos', 'estúpidas',
    'imbécil', 'imbéciles',
    'tarado', 'tarada', 'tarados', 'taradas',
    'retrasado', 'retrasada', 'retrasados', 'retrasadas',
    
    // Insultos vulgares
    'mierda', 'mierdas',
    'puto', 'puta', 'putos', 'putas',
    'cabrón', 'cabrona', 'cabrones', 'cabronas',
    'culero', 'culera', 'culeros', 'culeras',
    'verga', 'vergas',
    'chingar', 'chingada', 'chingado', 'chingadera',
    'joder', 'jodido', 'jodida',
    'coger', 'cogida', 'cogido',
    'mamar', 'mamada', 'mamón', 'mamona',
    
    // Insultos sexuales/de género
    'perra', 'perro', 'perros', 'perras',
    'zorra', 'zorro', 'zorras', 'zorros',
    'ramera', 'rameras',
    'prostituta', 'prostituto',
    
    // Insultos raciales/discriminatorios
    'negro', 'negra', 'negritos', 'negritas', // cuando se usa como insulto
    'indio', 'india', // cuando se usa como insulto
    'maricón', 'maricona', 'marica',
    'joto', 'jota',
    'puto', // duplicado pero importante
    
    // Insultos adicionales comunes
    'bastardo', 'bastarda',
    'desgraciado', 'desgraciada',
    'maldito', 'maldita', 'malditos', 'malditas',
    'ojete', 'ojetes',
    'pinche',
  ],
  
  permitidas: [
    // Expresiones coloquiales que NO se censuran
    'pedo', 'pedos',
    'mames', 'mame',
    'madre', 'madres',
    'wey', 'güey', 'guey',
    'chale', 'chales',
    'alv', 'a la verga', // cuando no es insulto directo
    'fregado', 'fregada',
    'chido', 'chida',
  ]
};

/**
 * 🔍 Función mejorada de censura manual
 */
function censurarManualmente(texto) {
  console.log('🔧 Usando sistema de censura manual mejorado');
  
  if (!texto || typeof texto !== 'string') {
    return {
      palabras_censurar: [],
      nivel_censura: 'ninguno',
      requiere_revision_humana: false,
      metodo: 'manual'
    };
  }
  
  let textoCensurado = texto;
  const palabrasCensuradas = [];
  const textoLower = texto.toLowerCase();
  
  console.log('📝 Analizando texto:', texto);
  
  // Detectar contexto ofensivo
  const patronesOfensivos = [
    /\beres\s+un[a]?\s+/i,           // "eres un/una..."
    /\bes\s+un[a]?\s+/i,             // "es un/una..."
    /\bpinche\s+/i,                  // "pinche..."
    /\bmaldito[a]?\s+/i,             // "maldito/maldita..."
    /\bhijo\s+de\s+/i,               // "hijo de..."
    /\bhija\s+de\s+/i,               // "hija de..."
    /\bpedazo\s+de\s+/i,             // "pedazo de..."
    /\bputa\s+/i,                    // "puta..." (como adjetivo)
  ];
  
  const tieneContextoOfensivo = patronesOfensivos.some(patron => patron.test(texto));
  console.log('🎯 Contexto ofensivo detectado:', tieneContextoOfensivo);
  
  // Buscar cada palabra prohibida
  for (const palabra of PALABRAS_PROHIBIDAS.insultos) {
    // Crear regex que busque la palabra completa
    const regex = new RegExp(`\\b${palabra}\\b`, 'gi');
    const matches = textoLower.match(regex);
    
    if (matches) {
      console.log(`🔍 Palabra "${palabra}" encontrada en el texto`);
      
      // Determinar si debe censurarse
      const debesCensurar = tieneContextoOfensivo || 
                           // Palabras que SIEMPRE se censuran por ser muy ofensivas
                           ['pendejo', 'pendeja', 'idiota', 'estúpido', 'estúpida', 
                            'imbécil', 'puta', 'puto', 'cabrón', 'hijo de puta',
                            'perra', 'perro', 'zorra', 'maldito', 'maldita'].includes(palabra);
      
      if (debesCensurar) {
        console.log(`   ✅ Censurando "${palabra}"`);
        const censura = '*'.repeat(palabra.length);
        textoCensurado = textoCensurado.replace(regex, censura);
        
        palabrasCensuradas.push({
          palabra,
          categoria: 'lenguaje_ofensivo',
          contexto: tieneContextoOfensivo ? 'Insulto en contexto ofensivo' : 'Palabra altamente ofensiva'
        });
      } else {
        console.log(`   ℹ️ Palabra "${palabra}" permitida (sin contexto ofensivo)`);
      }
    }
  }
  
  // Calcular nivel de censura
  let nivelCensura = 'ninguno';
  if (palabrasCensuradas.length >= 5) nivelCensura = 'alto';
  else if (palabrasCensuradas.length >= 2) nivelCensura = 'moderado';
  else if (palabrasCensuradas.length > 0) nivelCensura = 'bajo';
  
  console.log(`📊 Resultado: ${palabrasCensuradas.length} palabras censuradas, nivel: ${nivelCensura}`);
  
  return {
    palabras_censurar: palabrasCensuradas,
    nivel_censura: nivelCensura,
    requiere_revision_humana: palabrasCensuradas.length > 3,
    metodo: 'manual',
    texto_censurado: textoCensurado
  };
}

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

  CENSURA_COMENTARIO: `Analiza el siguiente comentario y determina qué palabras ofensivas deben censurarse.

COMENTARIO: "{comentario}"

REGLAS ESTRICTAS:

1. SIEMPRE CENSURAR:
   - Insultos directos a personas: "eres un pendejo", "idiota", "estúpido"
   - Insultos con objetivo: "maldita perra", "pinche idiota", "hijo de puta"
   - Ataques personales: cualquier insulto + persona/nombre

2. PERMITIR (expresión sin objetivo):
   - "qué pedo" (saludo)
   - "no mames" (sorpresa)
   - "estoy hasta la madre" (frustración personal)
   - "esta situación es una mierda" (sin mencionar persona)

3. CONTEXTO:
   - Si menciona: persona + insulto = CENSURAR
   - Si solo expresa frustración general = PERMITIR

Responde SOLO en formato JSON (sin markdown, sin texto extra):
{
  "palabras_censurar": [
    {
      "palabra": "palabra_exacta_a_censurar",
      "categoria": "insulto_directo|lenguaje_ofensivo",
      "contexto": "breve explicación"
    }
  ],
  "nivel_censura": "ninguno|bajo|moderado|alto",
  "requiere_revision_humana": false
}`
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
        contents: [{
          role: 'user',
          parts: [{ text: 'Di "OK"' }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 10,
        },
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
        console.log(`⚠️ Cuota agotada en ${nombreModelo}, probando siguiente modelo...`);
        continue; // Probar el siguiente en lugar de rendirse
      }
      
      console.log(`❌ Modelo ${nombreModelo} no disponible: ${error.message}`);
      continue;
    }
  }

  console.log('⚠️ Ningún modelo de Gemini disponible, usando censura manual');
  usarCensuraManual = true;
  return null;
}

function obtenerModelo(tipoModelo = 'FLASH') {
  if (usarCensuraManual || !genAI) {
    return null;
  }
  
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
      
      if (intento === reintentos - 1) {
        throw error;
      }

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

/**
 * 🔧 Función mejorada para extraer JSON con mejor manejo de errores
 */
function extraerJSON(texto) {
  console.log('🔍 extraerJSON - Recibido:');
  console.log('   Tipo:', typeof texto);
  console.log('   Longitud:', texto?.length);
  console.log('   Contenido:', texto);
  
  if (!texto || texto.trim().length === 0) {
    console.warn('⚠️ Respuesta vacía de Gemini');
    return {
      palabras_censurar: [],
      nivel_censura: 'ninguno',
      requiere_revision_humana: false,
      error: 'respuesta_vacia'
    };
  }
  
  try {
    // Limpiar markdown
    let jsonStr = texto.trim();
    console.log('   Texto limpio inicial:', jsonStr.substring(0, 100) + '...');
    
    jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    console.log('   Texto sin markdown:', jsonStr.substring(0, 100) + '...');
    
    // Buscar el objeto JSON
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.warn('⚠️ No se encontró JSON válido en la respuesta');
      console.warn('   Texto buscado:', jsonStr);
      return {
        palabras_censurar: [],
        nivel_censura: 'error',
        requiere_revision_humana: true,
        error: 'json_no_encontrado'
      };
    }

    console.log('   JSON encontrado:', jsonMatch[0].substring(0, 100) + '...');
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('   JSON parseado exitosamente');
    
    // Validar estructura mínima
    if (!parsed.hasOwnProperty('palabras_censurar')) {
      console.warn('⚠️ JSON sin estructura esperada');
      console.warn('   Propiedades encontradas:', Object.keys(parsed));
      return {
        palabras_censurar: [],
        nivel_censura: 'error',
        requiere_revision_humana: true,
        error: 'estructura_invalida'
      };
    }
    
    console.log('✅ JSON extraído exitosamente');
    return parsed;
    
  } catch (error) {
    console.error('❌ Error parseando JSON:', error.message);
    console.error('   Stack:', error.stack);
    return {
      palabras_censurar: [],
      nivel_censura: 'error',
      requiere_revision_humana: true,
      error: 'parse_error',
      error_detail: error.message
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
      console.log(`🎯 Modo: IA + Censura Manual (fallback)`);
      console.log('========================================');
    } else {
      console.log('========================================');
      console.log('⚠️ MODO: CENSURA MANUAL ÚNICAMENTE');
      console.log('La app funcionará pero sin IA');
      console.log('========================================');
    }

  } catch (error) {
    console.error('❌ Error verificando Gemini:', error.message);
    console.log('⚠️ Activando censura manual');
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
  PALABRAS_PROHIBIDAS, // Exportar para testing
};