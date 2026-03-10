const db = require('../config/database');

class Grupo {
    static async crear(datos) {
        const { nombre, descripcion, creador_id, privacidad, req_aprobacion } = datos;
        const [result] = await db.query(
            'INSERT INTO grupos (nombre, descripcion, creador_id, privacidad, req_aprobacion) VALUES (?, ?, ?, ?, ?)',
            [nombre, descripcion, creador_id, privacidad || 'publico', req_aprobacion ? 1 : 0]
        );
        return result.insertId;
    }

    static async obtenerPorId(id) {
        const [rows] = await db.query('SELECT * FROM grupos WHERE id = ?', [id]);
        return rows[0];
    }

    static async esMiembro(grupo_id, usuario_id) {
        const [rows] = await db.query(
            'SELECT * FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ? AND estado = "activo"',
            [grupo_id, usuario_id]
        );
        return rows.length > 0;
    }

    static async obtenerPublicaciones(grupo_id, usuario_actual_id) {
        const [rows] = await db.query(`
            SELECT p.*, u.nombre_usuario, u.foto_perfil_url,
            (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id) as total_likes,
            (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id AND usuario_id = ?) as liked
            FROM publicaciones p
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.grupo_id = ?
            ORDER BY p.fecha_creacion DESC
        `, [usuario_actual_id, grupo_id]);
        return rows;
    }
}

module.exports = Grupo;
