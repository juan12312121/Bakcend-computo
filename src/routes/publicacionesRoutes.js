const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { proteger } = require('../middlewares/auth');
const publicacionController = require('../controllers/publicacionesController');

// Configuración de Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/publicaciones'));
  },
  filename: (req, file, cb) => {
    const nombreArchivo = `${Date.now()}-${file.originalname}`;
    cb(null, nombreArchivo);
  }
});
const upload = multer({ storage });

// CRUD - ORDEN CORRECTO (rutas específicas ANTES de rutas con parámetros)
router.post('/', proteger, upload.single('imagen'), publicacionController.crearPublicacion);
router.get('/', publicacionController.obtenerPublicaciones); // feed
router.get('/mis-publicaciones', proteger, publicacionController.obtenerMisPublicaciones); // ⬅️ MOVER ANTES de /:id
router.get('/usuario/:usuarioId', publicacionController.obtenerPublicacionesUsuario); // publicaciones de otro usuario
router.get('/:id', publicacionController.obtenerPublicacion); // ⬅️ MOVER AL FINAL (rutas con parámetros siempre al final)
router.put('/:id', proteger, upload.single('imagen'), publicacionController.actualizarPublicacion);
router.delete('/:id', proteger, publicacionController.eliminarPublicacion);

module.exports = router;