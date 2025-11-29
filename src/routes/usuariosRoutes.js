// routes/usuarios.js - Archivo completo actualizado

const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuariosController');
const { proteger } = require('../middlewares/auth');
const { validarActualizarPerfil } = require('../utils/validators');
const { validarResultado } = require('../middlewares/validation');

// Configuración de upload
let upload;
try {
  const awsConfig = require('../config/aws');
  if (awsConfig && awsConfig.upload) {
    console.log('✅ Usando almacenamiento en AWS S3');
    upload = awsConfig.upload;
  } else {
    throw new Error('Falta configuración de AWS');
  }
} catch (err) {
  console.warn('⚠️ AWS S3 no disponible, usando almacenamiento local');
  const multerConfig = require('../config/multer');
  upload = multerConfig.upload;
}

// ================= RUTAS DE PERFIL =================
router.get('/me', proteger, usuariosController.obtenerMiPerfil);
router.get('/buscar', proteger, usuariosController.buscarUsuarios);

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

router.delete('/me', proteger, usuariosController.eliminarCuenta);

// ================= RUTAS DE ACTIVIDAD =================

// PUT /api/usuarios/me/actividad - Actualizar estado de actividad
router.put('/me/actividad', proteger, usuariosController.actualizarActividad);

// POST /api/usuarios/me/heartbeat - Enviar heartbeat para mantener activo
router.post('/me/heartbeat', proteger, usuariosController.heartbeat);

// 👉 GET /api/usuarios/me/seguidores/activos - Obtener MIS seguidores activos
router.get('/me/seguidores/activos', proteger, usuariosController.obtenerSeguidoresActivos);

// GET /api/usuarios/activos - Obtener todos los usuarios activos (general)
router.get('/activos', proteger, usuariosController.obtenerUsuariosActivos);

// ⚠️ IMPORTANTE: Esta ruta debe ir AL FINAL para no interferir con otras rutas
// GET /api/usuarios/:id - Perfil de un usuario por ID
router.get('/:id', proteger, usuariosController.obtenerPerfil);

module.exports = router;