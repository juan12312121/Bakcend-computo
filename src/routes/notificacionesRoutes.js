const express = require('express');
const router = express.Router();
const NotificacionController = require('../controllers/notificacionesController');
const { proteger } = require('../middlewares/auth');

/**
 * ============================================
 * RUTAS DE NOTIFICACIONES
 * ============================================
 * Todas requieren autenticación
 * Base URL: /api/notificaciones
 * ============================================
 */

// ========================================
// OBTENER NOTIFICACIONES
// ========================================

// GET /api/notificaciones?limit=20&offset=0
// Obtiene todas las notificaciones del usuario (paginadas)
router.get('/', proteger, NotificacionController.obtenerTodas);

// GET /api/notificaciones/no-leidas
// Obtiene solo las notificaciones no leídas
router.get('/no-leidas', proteger, NotificacionController.obtenerNoLeidas);

// GET /api/notificaciones/contador
// Obtiene el contador de notificaciones no leídas
router.get('/contador', proteger, NotificacionController.contarNoLeidas);

// ========================================
// MARCAR COMO LEÍDAS
// ========================================

// PUT /api/notificaciones/leer-todas
// Marca todas las notificaciones como leídas
router.put('/leer-todas', proteger, NotificacionController.marcarTodasComoLeidas);

// PUT /api/notificaciones/:id/leer
// Marca una notificación específica como leída
router.put('/:id/leer', proteger, NotificacionController.marcarComoLeida);

// ========================================
// ELIMINAR NOTIFICACIONES
// ========================================

// DELETE /api/notificaciones/:id
// Elimina una notificación específica
router.delete('/:id', proteger, NotificacionController.eliminar);

// DELETE /api/notificaciones/limpiar-antiguas
// Elimina notificaciones con más de 30 días (Admin/Mantenimiento)
router.delete('/limpiar-antiguas', proteger, NotificacionController.limpiarAntiguas);

module.exports = router;