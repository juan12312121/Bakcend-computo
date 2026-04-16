const { Server } = require('socket.io');

let io;

const init = (server) => {
    io = new Server(server, {
        cors: {
            origin: [
                'http://localhost:4200',
                'http://localhost:8100',
                'http://localhost:8080',
                'http://localhost',
                'http://192.168.100.70:4200',
                'http://192.168.100.70:3000',
                'http://192.168.100.70'
            ],
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log('🔌 Nuevo cliente conectado:', socket.id);

        // Unirse a sala personal del usuario para notificaciones globales
        socket.on('join_user_room', (userId) => {
            socket.join(`user_${userId}`);
            console.log(`👤 Usuario ${userId} unido a su sala personal`);
        });

        // Unirse a una sala privada de chat
        socket.on('join_chat', (chatId) => {
            socket.join(`chat_${chatId}`);
            console.log(`💬 Cliente ${socket.id} unido a chat_${chatId}`);
        });

        socket.on('leave_chat', (chatId) => {
            socket.leave(`chat_${chatId}`);
            console.log(`💬 Cliente ${socket.id} salió de chat_${chatId}`);
        });

        // 👥 Salas de grupos
        socket.on('join_group', (grupoId) => {
            socket.join(`group_${grupoId}`);
            console.log(`👥 Cliente ${socket.id} unido a group_${grupoId}`);
        });

        socket.on('leave_group', (grupoId) => {
            socket.leave(`group_${grupoId}`);
            console.log(`👥 Cliente ${socket.id} salió de group_${grupoId}`);
        });

        // Manejar envío de mensajes (opcional si se usa REST para enviar)
        // Pero útil para notificar instantáneamente
        socket.on('send_message', (data) => {
            // data debe contener chatId, mensaje, emisorId, etc.
            io.to(`chat_${data.chatId}`).emit('new_message', data);
        });

        socket.on('disconnect', () => {
            console.log('🔌 Cliente desconectado:', socket.id);
        });
    });

    return io;
};

const getIo = () => {
    if (!io) {
        throw new Error('Socket.io no ha sido inicializado');
    }
    return io;
};

module.exports = { init, getIo };
