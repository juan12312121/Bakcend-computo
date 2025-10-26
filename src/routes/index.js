const express = require('express');
const router = express.Router();

// Importar rutas
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');

// Usar rutas
router.use('/auth', authRoutes);
router.use('/usuarios', usuariosRoutes);

module.exports = router;