// models/MensajeChat.js
const db = require('../config/database');

class MensajeChat {
    static async crear({ chat_id, emisor_id, texto, archivo_url, tipo_archivo }) {
        const [resultado] = await db.execute(
            'INSERT INTO mensajes_chat (chat_id, emisor_id, texto, archivo_url, tipo_archivo) VALUES (?, ?, ?, ?, ?)',
            [chat_id, emisor_id, texto || '', archivo_url || null, tipo_archivo || null]
        );

        // Actualizar ultima_interaccion del chat
        await db.execute(
            'UPDATE chats SET ultima_interaccion = CURRENT_TIMESTAMP WHERE id = ?',
            [chat_id]
        );

        return {
            id: resultado.insertId,
            chat_id,
            emisor_id,
            texto: texto || '',
            archivo_url: archivo_url || null,
            tipo_archivo: tipo_archivo || null,
            fecha_creacion: new Date()
        };
    }

    static async obtenerPorChat(chat_id, limite = 50) {
        const limiteInt = parseInt(limite, 10) || 50;
        const query = `
      SELECT m.id, m.chat_id, m.emisor_id, m.texto, m.archivo_url, m.tipo_archivo, m.leido, m.fecha_creacion,
             u.nombre_usuario, u.nombre_completo
      FROM mensajes_chat m
      JOIN usuarios u ON m.emisor_id = u.id
      WHERE m.chat_id = ?
      ORDER BY m.fecha_creacion ASC
      LIMIT ${limiteInt}
    `;
        const [rows] = await db.execute(query, [chat_id]);
        return rows;
    }

    static async marcarComoLeido(chat_id, usuario_id) {
        await db.execute(
            'UPDATE mensajes_chat SET leido = 1 WHERE chat_id = ? AND emisor_id != ?',
            [chat_id, usuario_id]
        );
        return true;
    }
}

module.exports = MensajeChat;
