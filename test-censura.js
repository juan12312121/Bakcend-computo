require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function probarCensura() {
  const comentario = "puras pendejadas me deja poner";
  
  console.log('🧪 Probando censura con:', comentario);
  
  const prompt = `
    Analiza este comentario y detecta palabras ofensivas:
    "${comentario}"
    
    Responde SOLO en JSON:
    {
      "palabras_censurar": ["palabra1", "palabra2"],
      "nivel_censura": "ninguno|bajo|medio|alto"
    }
  `;
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    console.log('📝 Respuesta de Gemini:');
    console.log(response);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

probarCensura();
