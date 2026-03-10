const dotenv = require('dotenv');

// 🔥 Cargar variables de entorno PRIMERO
dotenv.config();

// Luego importar la app
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log('🚀 Servidor corriendo en puerto:', PORT);
  console.log('🌐 Host:', HOST);
  console.log('☁️  Almacenamiento: AWS S3');
  console.log('📦 Bucket:', process.env.AWS_BUCKET_NAME);
  console.log('🌍 Región:', process.env.AWS_REGION);
  console.log('🔧 Entorno:', process.env.NODE_ENV || 'development');
  console.log('🔗 API disponible en: http://localhost:' + PORT + '/api');
});