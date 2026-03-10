const express = require('express');
const router = express.Router();
const grupoController = require('../controllers/grupoController');
const auth = require('../middlewares/auth');
const { upload } = require('../config/multer');

router.get('/', auth.opcional, grupoController.listarGrupos);
router.get('/mis-grupos', auth.proteger, grupoController.misGrupos);
router.post('/', auth.proteger, upload.fields([{ name: 'foto_perfil', maxCount: 1 }, { name: 'foto_portada', maxCount: 1 }]), grupoController.crearGrupo);
router.get('/:id', auth.opcional, grupoController.obtenerGrupo);
router.post('/:id/unirse', auth.proteger, grupoController.unirseGrupo);
router.post('/:id/salir', auth.proteger, grupoController.salirGrupo);
router.get('/:id/publicaciones', auth.opcional, grupoController.obtenerPublicaciones);

module.exports = router;
