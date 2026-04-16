// controllers/chatController.js
const Chat = require('../models/Chat');
const MensajeChat = require('../models/MensajeChat');
const Seguidor = require('../models/Seguidor');
const socketConfig = require('../config/socket');

exports.obtenerChats = async (req, res) => {
    try {
        const chats = await Chat.obtenerLista(req.usuario.id);
        res.json({ success: true, data: chats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.obtenerMensajes = async (req, res) => {
    try {
        const { chatId } = req.params;
        console.log('📨 [obtenerMensajes] chatId:', chatId, '| tipo:', typeof chatId);
        console.log('📨 [obtenerMensajes] usuario.id:', req.usuario.id, '| tipo:', typeof req.usuario.id);

        const chat = await Chat.obtenerPorId(chatId);
        console.log('📨 [obtenerMensajes] chat encontrado:', chat);

        if (!chat) {
            console.log('❌ Chat no encontrado');
            return res.status(404).json({ success: false, message: 'Chat no encontrado' });
        }

        const u1 = Number(chat.usuario1_id);
        const u2 = Number(chat.usuario2_id);
        const uid = Number(req.usuario.id);
        console.log('📨 u1:', u1, 'u2:', u2, 'uid:', uid, '| pertenece:', uid === u1 || uid === u2);

        if (uid !== u1 && uid !== u2) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para ver este chat' });
        }

        console.log('📨 Obteniendo mensajes...');
        const mensajes = await MensajeChat.obtenerPorChat(chatId);
        console.log('📨 Mensajes obtenidos:', mensajes.length);

        await MensajeChat.marcarComoLeido(chatId, uid);
        res.json({ success: true, data: mensajes });
    } catch (error) {
        console.error('❌ [obtenerMensajes] ERROR COMPLETO:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.iniciarChat = async (req, res) => {
    try {
        const { receptorId } = req.body;
        const emisorId = req.usuario.id;

        if (Number(emisorId) === Number(receptorId)) {
            return res.status(400).json({ success: false, message: 'No puedes chatear contigo mismo' });
        }

        // Si el receptor sigue al emisor ⇒ chat directo (accepted)
        // Si no ⇒ solicitud de mensaje (pending)
        const receptorSigueEmisor = await Seguidor.verificar(receptorId, emisorId);
        const estadoInicial = receptorSigueEmisor ? 'accepted' : 'pending';

        const chat = await Chat.obtenerOCrear(emisorId, receptorId, estadoInicial);

        // Enriquecer con datos del otro usuario para el frontend
        const db = require('../config/database');
        const otroUsuarioId = Number(chat.usuario1_id) === Number(emisorId) ? chat.usuario2_id : chat.usuario1_id;
        const [usuarios] = await db.execute(
            'SELECT id, nombre_usuario, nombre_completo FROM usuarios WHERE id = ?',
            [otroUsuarioId]
        );
        const otroUsuario = usuarios[0] || {};

        res.json({
            success: true,
            data: {
                ...chat,
                nombre_usuario: otroUsuario.nombre_usuario,
                nombre_completo: otroUsuario.nombre_completo
            }
        });
    } catch (error) {
        console.error('❌ [iniciarChat] ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.enviarMensaje = async (req, res) => {
    try {
        const { chatId, texto } = req.body;
        const emisorId = req.usuario.id;

        // Verificar pertenencia al chat
        const chat = await Chat.obtenerPorId(chatId);
        if (!chat || (Number(chat.usuario1_id) !== Number(emisorId) && Number(chat.usuario2_id) !== Number(emisorId))) {
            return res.status(403).json({ success: false, message: 'No perteneces a este chat' });
        }

        const mensaje = await MensajeChat.crear({ chat_id: chatId, emisor_id: emisorId, texto });

        // ✅ Emitir en tiempo real
        try {
            const io = socketConfig.getIo();
            // Al chatroom (para quien esté dentro viendo el chat)
            io.to(`chat_${chatId}`).emit('new_message', {
                ...mensaje,
                chat_id: Number(chatId)
            });

            // Al usuario destinatario (para notificación global/header)
            const receptorId = Number(chat.usuario1_id) === Number(emisorId) ? chat.usuario2_id : chat.usuario1_id;
            io.to(`user_${receptorId}`).emit('new_message', {
                ...mensaje,
                chat_id: Number(chatId),
                is_global_notif: true
            });
        } catch (socketError) {
            console.warn('⚠️ Socket no disponible, pero mensaje guardado:', socketError.message);
        }

        res.json({ success: true, data: mensaje });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.aceptarSolicitud = async (req, res) => {
    try {
        const { chatId } = req.params;
        const usuarioId = req.usuario.id;

        const chat = await Chat.obtenerPorId(chatId);
        if (!chat || (chat.usuario1_id !== usuarioId && chat.usuario2_id !== usuarioId)) {
            return res.status(403).json({ success: false, message: 'No tienes permiso' });
        }

        await Chat.actualizarEstado(chatId, 'accepted');
        res.json({ success: true, message: 'Solicitud aceptada' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
