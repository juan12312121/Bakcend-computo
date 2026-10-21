const dotenv = require('dotenv');
dotenv.config();

const http = require('http');
const { Server } = require('socket.io');
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const socketConfig = require('./src/config/socket');
const server = http.createServer(app);

// Inicializar Socket.io con la configuración unificada
const io = socketConfig.init(server);

// Mantener compatibilidad con global.io
global.io = io;

const runMigrations = require('./runMigrations');

server.listen(PORT, HOST, async () => {
  console.log('🚀 Servidor corriendo en puerto:', PORT);
  console.log('🌐 Host:', HOST);
  console.log('🔧 Entorno:', process.env.NODE_ENV || 'development');
  
  // Ejecutar migraciones al arrancar
  await runMigrations();
});