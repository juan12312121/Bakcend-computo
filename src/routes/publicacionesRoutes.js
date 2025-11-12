const express = require('express');
const router = express.Router();
const { proteger } = require('../middlewares/auth');
const publicacionController = require('../controllers/publicacionesController');
const { upload } = require('../config/aws'); // ← usa el upload de S3

// ⚠️ Rutas específicas ANTES de rutas con parámetros
router.get('/categorias', publicacionController.obtenerCategorias);

// 🔧 Temporal: sin middleware opcional hasta estabilizar backend
router.get('/', publicacionController.obtenerPublicaciones);

router.post('/', proteger, upload.single('imagen'), publicacionController.crearPublicacion);
router.get('/mis-publicaciones', proteger, publicacionController.obtenerMisPublicaciones);
router.get('/usuario/:usuarioId', publicacionController.obtenerPublicacionesUsuario);

// ⚠️ Rutas con :id siempre al FINAL
router.get('/:id', publicacionController.obtenerPublicacion);
router.put('/:id', proteger, upload.single('imagen'), publicacionController.actualizarPublicacion);
router.delete('/:id', proteger, publicacionController.eliminarPublicacion);

module.exports = router;
