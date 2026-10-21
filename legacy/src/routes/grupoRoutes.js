const express = require('express');
const router = express.Router();
const grupoController = require('../controllers/grupoController');
const auth = require('../middlewares/auth');
const { upload } = require('../config/multer');

// Rutas estáticas (específicas primero para evitar que :id las capture)
router.get('/', auth.opcional, grupoController.listarGrupos);
router.get('/mis-grupos', auth.proteger, grupoController.obtenerMisGrupos);
router.get('/invitaciones', auth.proteger, grupoController.obtenerInvitaciones);
router.post('/invitaciones/:invitacion_id/responder', auth.proteger, grupoController.responderInvitacion);

// Rutas con ID
router.post('/', auth.proteger, upload.fields([{ name: 'foto_perfil', maxCount: 1 }, { name: 'foto_portada', maxCount: 1 }]), grupoController.crearGrupo);
router.get('/:id', auth.opcional, grupoController.obtenerDetalle);
router.post('/:id/unirse', auth.proteger, grupoController.unirseGrupo);
router.post('/:id/salir', auth.proteger, grupoController.salirGrupo);
router.get('/:id/publicaciones', auth.opcional, grupoController.obtenerPublicaciones);
router.post('/:id/invitar', auth.proteger, grupoController.invitarUsuario);
router.put('/:id', auth.proteger, upload.fields([{ name: 'foto_perfil', maxCount: 1 }, { name: 'foto_portada', maxCount: 1 }]), grupoController.actualizarGrupo);

module.exports = router;
