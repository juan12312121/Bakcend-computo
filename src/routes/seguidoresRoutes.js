const express = require('express');
const router = express.Router();
const SeguidoresController = require('../controllers/seguidoresController');

// Usa parámetros de ruta consistentemente
router.post('/seguir', SeguidoresController.seguir);
router.post('/dejar', SeguidoresController.dejarDeSeguir);
router.post('/toggle/:seguidor_id/:siguiendo_id', SeguidoresController.toggle);
router.get('/verificar/:seguidor_id/:siguiendo_id', SeguidoresController.verificar);
router.get('/seguidores/:id', SeguidoresController.listarSeguidores);
router.get('/seguidos/:id', SeguidoresController.listarSeguidos);

module.exports = router;