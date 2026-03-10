const dotenv = require('dotenv');
dotenv.config();

const http = require('http');
const app = require('./src/app');
const socketConfig = require('./src/config/socket');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const server = http.createServer(app);

// Inicializar Socket.io
const io = socketConfig.init(server);

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('========================================');
  console.log('🚀 SERVIDOR TRINOFLOW INICIADO');
  console.log('========================================');
  console.log('🌐 Host:', HOST);
  console.log('📡 Puerto:', PORT);
  console.log('💻 Local: http://localhost:' + PORT);
  console.log('📱 Red: http://' + HOST + ':' + PORT);
  console.log('');
  console.log('🔌 WebSocket: Habilitado (Socket.io)');
  console.log('🔧 Entorno:', process.env.NODE_ENV || 'development');
  console.log('');
  console.log('🔗 Endpoints disponibles:');
  console.log('   - API: /api');
  console.log('   - Health: /health');
  console.log('========================================');
  console.log('');
});

// Manejo graceful de cierre
process.on('SIGTERM', () => {
  console.log('👋 Cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando servidor...');
  process.exit(0);
});