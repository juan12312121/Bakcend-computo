const express = require('express');
const router = express.Router();
const seccionesController = require('../controllers/seccionesController');
const { proteger } = require('../middlewares/auth'); // o verificarToken

// CRUD de secciones
router.post('/', proteger, seccionesController.crearSeccion);
router.get('/', proteger, seccionesController.obtenerMisSecciones);
router.get('/:id', proteger, seccionesController.obtenerSeccion);
router.put('/:id', proteger, seccionesController.actualizarSeccion);
router.delete('/:id', proteger, seccionesController.eliminarSeccion);

// Gestión de posts en secciones
router.post('/posts/agregar', proteger, seccionesController.agregarPostASeccion);
router.post('/posts/quitar', proteger, seccionesController.quitarPostDeSeccion);
router.get('/posts/:publicacion_id', proteger, seccionesController.obtenerSeccionesDePost);

module.exports = router;