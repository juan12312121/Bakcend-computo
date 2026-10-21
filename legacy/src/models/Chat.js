// models/Chat.js
const db = require('../config/database');
const Seguidor = require('./Seguidor');

class Chat {
    // Crear u obtener un chat entre dos usuarios
    static async obtenerOCrear(usuario1_id, usuario2_id, estadoInicial = 'pending') {
        // Siempre el ID menor va primero para evitar duplicados invertidos
        const [u1, u2] = [usuario1_id, usuario2_id].sort((a, b) => a - b);

        // Buscar si ya existe
        const [existente] = await db.execute(
            'SELECT * FROM chats WHERE usuario1_id = ? AND usuario2_id = ?',
            [u1, u2]
        );

        if (existente.length > 0) {
            return existente[0];
        }

        // Crear nuevo chat con el estado determinado por si se siguen mutuamente
        const [resultado] = await db.execute(
            'INSERT INTO chats (usuario1_id, usuario2_id, estado) VALUES (?, ?, ?)',
            [u1, u2, estadoInicial]
        );

        return {
            id: resultado.insertId,
            usuario1_id: u1,
            usuario2_id: u2,
            estado: estadoInicial
        };
    }

    // Actualizar estado del chat (aceptar solicitud)
    static async actualizarEstado(id, estado) {
        await db.execute(
            'UPDATE chats SET estado = ? WHERE id = ?',
            [estado, id]
        );
        return true;
    }

    // Obtener lista de chats de un usuario
    static async obtenerLista(usuario_id) {
        const query = `
      SELECT 
        c.*,
        u.nombre_usuario,
        u.nombre_completo,
        u.foto_perfil_url,
        (SELECT texto FROM mensajes_chat WHERE chat_id = c.id ORDER BY fecha_creacion DESC LIMIT 1) as ultimo_mensaje,
        (SELECT fecha_creacion FROM mensajes_chat WHERE chat_id = c.id ORDER BY fecha_creacion DESC LIMIT 1) as fecha_ultimo_mensaje,
        (SELECT COUNT(*) FROM mensajes_chat WHERE chat_id = c.id AND emisor_id != ? AND leido = 0) as no_leidos
      FROM chats c
      INNER JOIN usuarios u ON (u.id = IF(c.usuario1_id = ?, c.usuario2_id, c.usuario1_id))
      WHERE c.usuario1_id = ? OR c.usuario2_id = ?
      ORDER BY c.ultima_interaccion DESC
    `;
        const [rows] = await db.execute(query, [usuario_id, usuario_id, usuario_id, usuario_id]);
        return rows;
    }

    static async obtenerPorId(id) {
        const [rows] = await db.execute('SELECT * FROM chats WHERE id = ?', [id]);
        return rows[0] || null;
    }
}

module.exports = Chat;
