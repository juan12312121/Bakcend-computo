// routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { proteger } = require('../middlewares/auth');

router.use(proteger); // Todas las rutas de chat requieren autenticación

router.get('/lista', chatController.obtenerChats);
router.get('/mensajes/:chatId', chatController.obtenerMensajes);
router.post('/iniciar', chatController.iniciarChat);
router.post('/enviar', chatController.enviarMensaje);
router.put('/aceptar/:chatId', chatController.aceptarSolicitud);

module.exports = router;
