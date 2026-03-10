// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { proteger, soloAdmin } = require('../middlewares/auth');

// Todas las rutas aquí requieren ser Admin
router.use(proteger);
router.use(soloAdmin);

/**
 * @route GET /api/admin/reportes
 * @desc Get all user reports
 */
router.get('/reportes', adminController.obtenerReportes);

/**
 * @route DELETE /api/admin/publicaciones/:id
 * @desc Delete a post by moderation
 */
router.delete('/publicaciones/:id', adminController.eliminarPublicacion);

/**
 * @route PATCH /api/admin/usuarios/:id/suspender
 * @desc Suspend a user
 */
router.patch('/usuarios/:id/suspender', adminController.suspenderUsuario);

/**
 * @route GET /api/admin/logs
 * @desc Get security audit logs
 */
router.get('/logs', adminController.obtenerLogs);

module.exports = router;
