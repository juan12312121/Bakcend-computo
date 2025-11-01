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

// ⚠️ IMPORTANTE: Rutas específicas ANTES de rutas con parámetros
router.get('/categorias', publicacionController.obtenerCategorias); 

// 🔧 TEMPORAL: Quitar middleware hasta arreglar el backend
// Cambiar de:
// router.get('/', protegerOpcional, publicacionController.obtenerPublicaciones);
// A:
router.get('/', publicacionController.obtenerPublicaciones); 

router.post('/', proteger, upload.single('imagen'), publicacionController.crearPublicacion);
router.get('/mis-publicaciones', proteger, publicacionController.obtenerMisPublicaciones);
router.get('/usuario/:usuarioId', publicacionController.obtenerPublicacionesUsuario);

// ⚠️ Rutas con :id siempre al FINAL
router.get('/:id', publicacionController.obtenerPublicacion);
router.put('/:id', proteger, upload.single('imagen'), publicacionController.actualizarPublicacion);
router.delete('/:id', proteger, publicacionController.eliminarPublicacion);

module.exports = router;