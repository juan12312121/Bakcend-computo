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

        // Unirse a una sala privada de chat
        socket.on('join_chat', (chatId) => {
            socket.join(`chat_${chatId}`);
            console.log(`💬 Usuario unido al chat: ${chatId}`);
        });

        // Salir de una sala de chat
        socket.on('leave_chat', (chatId) => {
            socket.leave(`chat_${chatId}`);
            console.log(`💬 Usuario salió del chat: ${chatId}`);
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
