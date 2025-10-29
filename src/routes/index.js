const express = require('express');
const router = express.Router();

// Importar rutas
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');
const publicacionesRoutes = require('./publicacionesRoutes');

// Usar rutas
router.use('/auth', authRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/publicaciones', publicacionesRoutes)

module.exports = router;