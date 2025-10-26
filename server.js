const app = require('./src/app');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(` Servidor corriendo en puerto ${PORT}`);
  console.log(` Entorno: ${process.env.NODE_ENV}`);
  console.log(` API disponible en: http://localhost:${PORT}/api`);
});