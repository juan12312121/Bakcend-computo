/**
 * routes/notificacionesRoutes.js
 * Rutas de notificaciones con SSE integrado
 */

const express = require('express');
const router = express.Router();
const NotificacionController = require('../controllers/notificacionesController');
const { proteger } = require('../middlewares/auth');
const jwt = require('jsonwebtoken');

/**
 * ============================================
 * ALMACENAMIENTO DE CONEXIONES SSE
 * ============================================
 */
// Map<usuarioId, Set<response>>
const conexionesSSE = new Map();

/**
 * ============================================
 * MIDDLEWARE ESPECIAL PARA SSE (sin headers)
 * ============================================
 */
function protegerSSE(req, res, next) {
  try {
    // El token puede venir en query params porque EventSource no soporta headers
    const token = req.query.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No se proporcionó token de autenticación'
      });
    }

    // Verificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (error) {
    console.error('❌ Error en autenticación SSE:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
}

/**
 * ============================================
 * FUNCIONES HELPER PARA SSE
 * ============================================
 */

/**
 * Enviar evento SSE a un usuario específico
 */
function enviarEventoSSE(usuarioId, evento, data) {
  const conexiones = conexionesSSE.get(usuarioId);
  
  if (!conexiones || conexiones.size === 0) {
    console.log(`ℹ️ Usuario ${usuarioId} no tiene conexiones SSE activas`);
    return false;
  }

  console.log(`📤 Enviando evento "${evento}" a usuario ${usuarioId} (${conexiones.size} conexiones)`);

  const mensaje = `event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`;
  
  // Enviar a todas las conexiones del usuario
  const conexionesValidas = new Set();
  conexiones.forEach(res => {
    try {
      res.write(mensaje);
      conexionesValidas.add(res);
    } catch (error) {
      console.error(`❌ Error al enviar evento:`, error.message);
    }
  });

  // Actualizar solo con conexiones válidas
  if (conexionesValidas.size > 0) {
    conexionesSSE.set(usuarioId, conexionesValidas);
  } else {
    conexionesSSE.delete(usuarioId);
  }

  return true;
}

/**
 * Obtener estadísticas de conexiones activas
 */
function obtenerEstadisticasSSE() {
  let totalConexiones = 0;
  conexionesSSE.forEach(conexiones => {
    totalConexiones += conexiones.size;
  });
  return {
    usuariosConectados: conexionesSSE.size,
    conexionesTotales: totalConexiones
  };
}

/**
 * ============================================
 * RUTAS DE NOTIFICACIONES
 * ============================================
 */

// ========================================
// 🆕 SSE - STREAM DE NOTIFICACIONES EN TIEMPO REAL
// ========================================
// GET /api/notificaciones/stream/:usuarioId?token=JWT_TOKEN
router.get('/stream/:usuarioId', protegerSSE, (req, res) => {
  const usuarioId = parseInt(req.params.usuarioId);

  // Verificar que el usuario del token coincida con el solicitado
  if (req.usuario.id !== usuarioId) {
    return res.status(403).json({ 
      success: false, 
      message: 'No autorizado para esta stream' 
    });
  }

  console.log(`🔌 Usuario ${usuarioId} conectándose a SSE...`);

  // Configurar headers para SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Para nginx
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true'
  });

  // Flushear headers inmediatamente
  res.flushHeaders();

  // Guardar la conexión
  if (!conexionesSSE.has(usuarioId)) {
    conexionesSSE.set(usuarioId, new Set());
  }
  conexionesSSE.get(usuarioId).add(res);

  const stats = obtenerEstadisticasSSE();
  console.log(`✅ Usuario ${usuarioId} conectado a SSE`);
  console.log(`👥 SSE Stats - Usuarios: ${stats.usuariosConectados}, Conexiones: ${stats.conexionesTotales}`);

  // Enviar mensaje inicial de conexión
  res.write(`event: connected\ndata: ${JSON.stringify({ 
    message: 'Conectado a notificaciones en tiempo real', 
    usuarioId,
    timestamp: new Date().toISOString() 
  })}\n\n`);

  // Enviar heartbeat cada 30 segundos para mantener la conexión viva
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`:heartbeat ${Date.now()}\n\n`);
    } catch (error) {
      console.log(`❌ Error en heartbeat para usuario ${usuarioId}`);
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  // Limpiar al cerrar la conexión
  req.on('close', () => {
    console.log(`🔌 Usuario ${usuarioId} desconectado de SSE`);
    clearInterval(heartbeatInterval);
    
    const conexiones = conexionesSSE.get(usuarioId);
    if (conexiones) {
      conexiones.delete(res);
      if (conexiones.size === 0) {
        conexionesSSE.delete(usuarioId);
      }
    }
    
    const statsAfter = obtenerEstadisticasSSE();
    console.log(`👥 SSE Stats - Usuarios: ${statsAfter.usuariosConectados}, Conexiones: ${statsAfter.conexionesTotales}`);
    
    res.end();
  });
});

// ========================================
// OBTENER NOTIFICACIONES
// ========================================

// GET /api/notificaciones?limit=20&offset=0
router.get('/', proteger, NotificacionController.obtenerTodas);

// GET /api/notificaciones/no-leidas
router.get('/no-leidas', proteger, NotificacionController.obtenerNoLeidas);

// GET /api/notificaciones/contador
router.get('/contador', proteger, NotificacionController.contarNoLeidas);

// ========================================
// MARCAR COMO LEÍDAS
// ========================================

// PUT /api/notificaciones/leer-todas
router.put('/leer-todas', proteger, NotificacionController.marcarTodasComoLeidas);

// PUT /api/notificaciones/:id/leer
router.put('/:id/leer', proteger, NotificacionController.marcarComoLeida);

// ========================================
// ELIMINAR NOTIFICACIONES
// ========================================

// DELETE /api/notificaciones/:id
router.delete('/:id', proteger, NotificacionController.eliminar);

// DELETE /api/notificaciones/limpiar-antiguas
router.delete('/limpiar-antiguas', proteger, NotificacionController.limpiarAntiguas);

// ========================================
// 🆕 MONITOREO DE SSE (Opcional - solo para desarrollo)
// ========================================
router.get('/sse/stats', proteger, (req, res) => {
  const stats = obtenerEstadisticasSSE();
  res.json({
    success: true,
    data: {
      ...stats,
      usuariosConectados: Array.from(conexionesSSE.keys())
    }
  });
});

/**
 * ============================================
 * EXPORTAR ROUTER Y FUNCIONES
 * ============================================
 * ✅ EXPORTACIÓN CORREGIDA PARA EVITAR ERRORES
 */

// Exportar el router como default
module.exports = router;

// Exportar funciones adicionales como propiedades del módulo
module.exports.enviarEventoSSE = enviarEventoSSE;
module.exports.conexionesSSE = conexionesSSE;
module.exports.obtenerEstadisticasSSE = obtenerEstadisticasSSE;