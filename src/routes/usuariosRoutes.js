const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuariosController');
const { proteger } = require('../middlewares/auth');
const { validarActualizarPerfil } = require('../utils/validators');
const { validarResultado } = require('../middlewares/validation');

// Intentar usar AWS S3 si existe configuración válida
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

// ================= RUTAS =================

// GET /api/usuarios/me - Mi perfil
router.get('/me', proteger, usuariosController.obtenerMiPerfil);

// GET /api/usuarios/buscar?q=juan - Buscar usuarios
router.get('/buscar', proteger, usuariosController.buscarUsuarios);

// GET /api/usuarios/:id - Perfil de un usuario
router.get('/:id', proteger, usuariosController.obtenerPerfil);

// PUT /api/usuarios/me - Actualizar perfil con imágenes
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

module.exports = router;
