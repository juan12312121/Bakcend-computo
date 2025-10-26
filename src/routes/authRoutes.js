const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { proteger } = require('../middlewares/auth');
const { validarRegistro, validarLogin } = require('../utils/validators');
const { validarResultado } = require('../middlewares/validation');

// POST /api/auth/registro
router.post('/registro', validarRegistro, validarResultado, authController.registro);

// POST /api/auth/login
router.post('/login', validarLogin, validarResultado, authController.login);

// POST /api/auth/logout
router.post('/logout', proteger, authController.logout);

// GET /api/auth/verificar
router.get('/verificar', proteger, authController.verificarToken);

module.exports = router;