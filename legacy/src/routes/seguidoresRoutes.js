const express = require('express');
const router = express.Router();
const SeguidorController = require('../controllers/seguidoresController');
const { proteger } = require('../middlewares/auth');

/**
 * ============================================
 * RUTAS DE SEGUIDORES
 * ============================================
 * Todas requieren autenticación
 * Base URL: /api/seguidores
 * 
 * ⚠️ IMPORTANTE: Las rutas con texto fijo DEBEN ir
 *    ANTES de las rutas con parámetros dinámicos
 * ============================================
 */

// ========================================
// ACCIONES DE SEGUIMIENTO
// ========================================

// POST /api/seguidores/seguir
// Body: { seguido_id: number }
router.post('/seguir', proteger, SeguidorController.seguir);

// DELETE /api/seguidores/dejar-de-seguir
// Body: { seguido_id: number }
router.delete('/dejar-de-seguir', proteger, SeguidorController.dejarDeSeguir);

// POST /api/seguidores/toggle
// Body: { seguido_id: number }
router.post('/toggle', proteger, SeguidorController.toggleSeguir);

// ========================================
// CONSULTAS - RUTAS ESPECÍFICAS PRIMERO
// ========================================

// ✅ ORDEN CORRECTO: Rutas específicas antes de parámetros

// GET /api/seguidores/estadisticas/:usuario_id
// Obtener estadísticas (total seguidores y seguidos)
router.get('/estadisticas/:usuario_id', proteger, SeguidorController.obtenerEstadisticas);

// GET /api/seguidores/seguidos/:usuario_id?limit=50&offset=0
// Listar usuarios que este usuario sigue
router.get('/seguidos/:usuario_id', proteger, SeguidorController.obtenerSeguidos);

// GET /api/seguidores/siguiendo/:usuario_id?limit=50&offset=0 (ALIAS)
// Alias para seguidos - misma funcionalidad
router.get('/siguiendo/:usuario_id', proteger, SeguidorController.obtenerSeguidos);

// GET /api/seguidores/seguidores/:usuario_id?limit=50&offset=0
// Listar usuarios que siguen a este usuario
router.get('/seguidores/:usuario_id', proteger, SeguidorController.obtenerSeguidores);

// GET /api/seguidores/verificar/:usuario_id
// Verificar si el usuario autenticado sigue a otro usuario
router.get('/verificar/:usuario_id', proteger, SeguidorController.verificarSiguiendo);


module.exports = router;