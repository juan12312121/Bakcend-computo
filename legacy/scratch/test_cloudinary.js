require('dotenv').config();
const cloudinary = require('cloudinary').v2;

const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();

console.log('--- Probando lo que hay en el .env ---');
console.log('Nom de nube:', `[${cloudName}]`);

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret
});

async function test() {
  try {
    const result = await cloudinary.api.ping();
    console.log('✅ ¡CONEXIÓN EXITOSA!', result);
  } catch (err) {
    console.log('❌ FALLÓ');
    if (err.error) console.log('Error:', err.error.message);
    else console.log('Error:', err.message);
  }
}

test();
