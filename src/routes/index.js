const express = require('express');
const router = express.Router();

// Importar rutas
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');
const publicacionesRoutes = require('./publicacionesRoutes');
const seguidoresRoutes = require('./seguidoresRoutes');
const fotosRoutes = require('./fotos');
const comentariosRoutes = require('./comentariosRoutes');

// Usar rutas
router.use('/auth', authRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/publicaciones', publicacionesRoutes);
router.use('/seguidores', seguidoresRoutes);
router.use('/fotos', fotosRoutes);
router.use('/comentarios', comentariosRoutes);

module.exports = router;