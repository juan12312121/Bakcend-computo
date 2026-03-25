const express = require('express');
const router = express.Router();

// Importar rutas
const authRoutes = require('./authRoutes');
const usuariosRoutes = require('./usuariosRoutes');
const publicacionesRoutes = require('./publicacionesRoutes');
const seguidoresRoutes = require('./seguidoresRoutes');
const fotosRoutes = require('./fotos');
const comentariosRoutes = require('./comentariosRoutes');
const seccionesRoutes = require('./secciones');
const likeRoutes = require('./like');
const notificacionesRoutes = require('./notificacionesRoutes');
const reporteRoutes = require('./reporteRoutes');
const documentosRoutes = require('./documentos');
const grupoRoutes = require('./grupoRoutes');
const chatRoutes = require('./chatRoutes');
const aiRoutes = require('./aiRoutes');
const adminRoutes = require('./adminRoutes');

// Usar rutas
router.use('/auth', authRoutes);
router.use('/usuarios', usuariosRoutes);
router.use('/publicaciones', publicacionesRoutes);
router.use('/seguidores', seguidoresRoutes);
router.use('/fotos', fotosRoutes);
router.use('/comentarios', comentariosRoutes);
router.use('/secciones', seccionesRoutes);
router.use('/likes', likeRoutes);
router.use('/notificaciones', notificacionesRoutes);
router.use('/reportes', reporteRoutes);
router.use('/documentos', documentosRoutes);
router.use('/grupos', grupoRoutes);
router.use('/chat', chatRoutes);
router.use('/ai', aiRoutes);
router.use('/admin', adminRoutes);

module.exports = router;