// =============================================================================
// routes/usuarios.js - SOLO ALMACENAMIENTO LOCAL
// =============================================================================

const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuariosController');
const { proteger } = require('../middlewares/auth');
const { validarActualizarPerfil } = require('../utils/validators');
const { validarResultado } = require('../middlewares/validation');

// ✅ USAR SOLO MULTER LOCAL
const { upload } = require('../config/multer');

console.log('📁 Rutas de usuarios configuradas con almacenamiento LOCAL');

// ================= RUTAS DE PERFIL =================

// GET /api/usuarios/me - Obtener mi perfil
router.get('/me', proteger, usuariosController.obtenerMiPerfil);

// GET /api/usuarios/buscar?q=nombre - Buscar usuarios
router.get('/buscar', proteger, usuariosController.buscarUsuarios);

// PUT /api/usuarios/me - Actualizar perfil con fotos
router.put(
  '/me',
  proteger,
  upload.fields([
    { name: 'foto_perfil', maxCount: 1 },
    { name: 'foto_portada', maxCount: 1 },
  ]),
  validarActualizarPerfil,
  validarResultado,
  usuariosController.actualizarPerfil
);

// DELETE /api/usuarios/me - Eliminar cuenta
router.delete('/me', proteger, usuariosController.eliminarCuenta);

// ================= RUTAS DE ACTIVIDAD =================

// PUT /api/usuarios/me/actividad - Actualizar estado de actividad
router.put('/me/actividad', proteger, usuariosController.actualizarActividad);

// POST /api/usuarios/me/heartbeat - Enviar heartbeat para mantener activo
router.post('/me/heartbeat', proteger, usuariosController.heartbeat);

// GET /api/usuarios/me/seguidores/activos - Obtener MIS seguidores activos
router.get('/me/seguidores/activos', proteger, usuariosController.obtenerSeguidoresActivos);

// GET /api/usuarios/activos - Obtener todos los usuarios activos (general)
router.get('/activos', proteger, usuariosController.obtenerUsuariosActivos);

// ⚠️ IMPORTANTE: Esta ruta debe ir AL FINAL para no interferir con otras rutas
// GET /api/usuarios/:id - Perfil de un usuario por ID
router.get('/:id', proteger, usuariosController.obtenerPerfil);

module.exports = router;