const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuariosController');
const { proteger } = require('../middlewares/auth');
const { validarActualizarPerfil } = require('../utils/validators');
const { validarResultado } = require('../middlewares/validation');

// GET /api/usuarios/me - Mi perfil
router.get('/me', proteger, usuariosController.obtenerMiPerfil);

// GET /api/usuarios/buscar?q=juan - Buscar usuarios
router.get('/buscar', proteger, usuariosController.buscarUsuarios);

// GET /api/usuarios/:id - Perfil de un usuario
router.get('/:id', proteger, usuariosController.obtenerPerfil);

// PUT /api/usuarios/me - Actualizar mi perfil
router.put('/me', proteger, validarActualizarPerfil, validarResultado, usuariosController.actualizarPerfil);

// DELETE /api/usuarios/me - Eliminar mi cuenta
router.delete('/me', proteger, usuariosController.eliminarCuenta);

module.exports = router;