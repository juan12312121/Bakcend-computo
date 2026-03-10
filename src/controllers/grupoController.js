const db = require('../config/database');

const grupoController = {
    // Listar todos los grupos
    listarGrupos: async (req, res) => {
        const usuario_id = req.usuario ? req.usuario.id : null;
        try {
            const [grupos] = await db.query(`
                SELECT g.*, u.nombre_usuario as creador_nombre,
                (SELECT COUNT(*) FROM grupo_miembros WHERE grupo_id = g.id) as total_miembros,
                (SELECT rol FROM grupo_miembros WHERE grupo_id = g.id AND usuario_id = ?) as mi_rol,
                (SELECT estado FROM grupo_miembros WHERE grupo_id = g.id AND usuario_id = ?) as mi_estado
                FROM grupos g
                JOIN usuarios u ON g.creador_id = u.id
                WHERE g.privacidad = 'publico'
                ORDER BY g.fecha_creacion DESC
            `, [usuario_id, usuario_id]);
            res.json({ success: true, data: grupos });
        } catch (error) {
            console.error('Error al listar grupos:', error);
            res.status(500).json({ success: false, message: 'Error al obtener grupos' });
        }
    },

    // Obtener grupos del usuario actual
    misGrupos: async (req, res) => {
        const usuario_id = req.usuario.id;
        try {
            const [grupos] = await db.query(`
                SELECT g.*, gm.rol
                FROM grupos g
                JOIN grupo_miembros gm ON g.id = gm.grupo_id
                WHERE gm.usuario_id = ? AND gm.estado = 'activo'
                ORDER BY g.fecha_creacion DESC
            `, [usuario_id]);
            res.json({ success: true, data: grupos });
        } catch (error) {
            console.error('Error al obtener mis grupos:', error);
            res.status(500).json({ success: false, message: 'Error al obtener tus grupos' });
        }
    },

    // Crear un grupo
    crearGrupo: async (req, res) => {
        const { nombre, descripcion, privacidad, req_aprobacion } = req.body;
        const creador_id = req.usuario.id;

        if (!nombre) {
            return res.status(400).json({ success: false, message: 'El nombre del grupo es obligatorio' });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const imagen_url = req.files && req.files['foto_perfil'] ? `/uploads/perfiles/${req.files['foto_perfil'][0].filename}` : null;
            const imagen_portada_url = req.files && req.files['foto_portada'] ? `/uploads/portadas/${req.files['foto_portada'][0].filename}` : null;

            const [result] = await connection.query(
                'INSERT INTO grupos (nombre, descripcion, creador_id, privacidad, req_aprobacion, imagen_url, imagen_portada_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [nombre, descripcion || '', creador_id, privacidad || 'publico', req_aprobacion ? 1 : 0, imagen_url, imagen_portada_url]
            );

            const grupo_id = result.insertId;

            // El creador se une automáticamente como admin
            await connection.query(
                'INSERT INTO grupo_miembros (grupo_id, usuario_id, rol, estado) VALUES (?, ?, ?, ?)',
                [grupo_id, creador_id, 'admin', 'activo']
            );

            await connection.commit();
            res.status(201).json({ success: true, message: 'Grupo creado con éxito', data: { id: grupo_id } });
        } catch (error) {
            await connection.rollback();
            console.error('Error al crear grupo:', error);
            res.status(500).json({ success: false, message: 'Error al crear el grupo' });
        } finally {
            connection.release();
        }
    },

    // Obtener detalle de un grupo
    obtenerGrupo: async (req, res) => {
        const { id } = req.params;
        const usuario_id = req.usuario ? req.usuario.id : null;

        try {
            const [grupos] = await db.query(`
                SELECT g.*, u.nombre_usuario as creador_nombre,
                (SELECT COUNT(*) FROM grupo_miembros WHERE grupo_id = g.id) as total_miembros,
                (SELECT rol FROM grupo_miembros WHERE grupo_id = g.id AND usuario_id = ?) as mi_rol,
                (SELECT estado FROM grupo_miembros WHERE grupo_id = g.id AND usuario_id = ?) as mi_estado
                FROM grupos g
                JOIN usuarios u ON g.creador_id = u.id
                WHERE g.id = ?
            `, [usuario_id, usuario_id, id]);

            if (grupos.length === 0) {
                return res.status(404).json({ success: false, message: 'Grupo no encontrado' });
            }

            res.json({ success: true, data: grupos[0] });
        } catch (error) {
            console.error('Error al obtener grupo:', error);
            res.status(500).json({ success: false, message: 'Error al obtener el grupo' });
        }
    },

    // Unirse a un grupo
    unirseGrupo: async (req, res) => {
        const { id } = req.params;
        const usuario_id = req.usuario.id;

        try {
            const [grupos] = await db.query('SELECT * FROM grupos WHERE id = ?', [id]);
            if (grupos.length === 0) {
                return res.status(404).json({ success: false, message: 'Grupo no encontrado' });
            }

            const grupo = grupos[0];
            const estado = grupo.req_aprobacion ? 'pendiente' : 'activo';

            await db.query(
                'INSERT INTO grupo_miembros (grupo_id, usuario_id, estado) VALUES (?, ?, ?)',
                [id, usuario_id, estado]
            );

            res.json({
                success: true,
                message: estado === 'pendiente' ? 'Solicitud enviada' : 'Te has unido al grupo',
                estado
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, message: 'Ya eres miembro o tienes una solicitud pendiente' });
            }
            console.error('Error al unirse al grupo:', error);
            res.status(500).json({ success: false, message: 'Error al unirse al grupo' });
        }
    },

    // Salir de un grupo
    salirGrupo: async (req, res) => {
        const { id } = req.params;
        const usuario_id = req.usuario.id;

        try {
            const [miembro] = await db.query('SELECT rol FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?', [id, usuario_id]);
            if (miembro.length === 0) {
                return res.status(400).json({ success: false, message: 'No eres miembro de este grupo' });
            }

            if (miembro[0].rol === 'admin') {
                const [admins] = await db.query('SELECT COUNT(*) as count FROM grupo_miembros WHERE grupo_id = ? AND rol = ?', [id, 'admin']);
                if (admins[0].count === 1) {
                    return res.status(400).json({ success: false, message: 'Debes nombrar otro admin antes de salir' });
                }
            }

            await db.query('DELETE FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?', [id, usuario_id]);
            res.json({ success: true, message: 'Has salido del grupo' });
        } catch (error) {
            console.error('Error al salir del grupo:', error);
            res.status(500).json({ success: false, message: 'Error al salir del grupo' });
        }
    },

    // Obtener publicaciones de un grupo
    obtenerPublicaciones: async (req, res) => {
        const { id } = req.params;
        const usuario_id = req.usuario ? req.usuario.id : null;

        try {
            // Verificar si el grupo existe
            const [grupos] = await db.query('SELECT id FROM grupos WHERE id = ?', [id]);
            if (grupos.length === 0) {
                return res.status(404).json({ success: false, message: 'Grupo no encontrado' });
            }

            const [publicaciones] = await db.query(`
                SELECT p.*, u.nombre_usuario, u.nombre_completo, u.foto_perfil_url,
                (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id) as total_likes,
                (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id AND usuario_id = ?) as usuario_dio_like
                FROM publicaciones p
                JOIN usuarios u ON p.usuario_id = u.id
                WHERE p.grupo_id = ?
                ORDER BY p.fecha_creacion DESC
            `, [usuario_id, id]);

            res.json({ success: true, data: publicaciones });
        } catch (error) {
            console.error('Error al obtener publicaciones del grupo:', error);
            res.status(500).json({ success: false, message: 'Error al obtener publicaciones' });
        }
    }
};

module.exports = grupoController;
