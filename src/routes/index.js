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
const adminRoutes = require('./adminRoutes');
const aiRoutes = require('./aiRoutes');
const chatRoutes = require('./chatRoutes');
const grupoRoutes = require('./grupoRoutes');

// Usar rutas
router.use('/admin', adminRoutes);
router.use('/ai', aiRoutes);
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
router.use('/chat', chatRoutes);
router.use('/grupos', grupoRoutes);

module.exports = router;