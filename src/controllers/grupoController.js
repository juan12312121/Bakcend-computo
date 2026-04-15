const db = require('../config/database');
const Notificacion = require('../models/Notificacion');

const grupoController = {
    // Listar todos los grupos
    listarGrupos: async (req, res) => {
        const usuario_id = req.usuario ? req.usuario.id : null;
        try {
            const [grupos] = await db.query(`
                SELECT g.*, u.nombre_usuario as creador_nombre,
                (SELECT COUNT(*) FROM grupo_miembros WHERE grupo_id = g.id) as total_miembros,
                (SELECT estado FROM grupo_miembros WHERE grupo_id = g.id AND usuario_id = ?) as mi_estado
                FROM grupos g
                JOIN usuarios u ON g.creador_id = u.id
                ORDER BY g.fecha_creacion DESC
            `, [usuario_id]);

            res.json({ success: true, data: grupos });
        } catch (error) {
            console.error('Error al listar grupos:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Obtener grupos donde el usuario es miembro
    obtenerMisGrupos: async (req, res) => {
        try {
            const usuario_id = req.usuario.id;
            const [grupos] = await db.query(`
                SELECT g.*, gm.estado as mi_estado,
                (SELECT COUNT(*) FROM grupo_miembros WHERE grupo_id = g.id) as total_miembros
                FROM grupos g
                JOIN grupo_miembros gm ON g.id = gm.grupo_id
                WHERE gm.usuario_id = ? AND gm.estado = 'activo'
                ORDER BY g.fecha_creacion DESC
            `, [usuario_id]);

            res.json({ success: true, data: grupos });
        } catch (error) {
            console.error('Error al obtener mis grupos:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Crear un nuevo grupo
    crearGrupo: async (req, res) => {
        try {
            const { nombre, descripcion, privacidad } = req.body;
            const creador_id = req.usuario.id;

            // Manejo de imágenes estandarizado: 
            // - Avatar del grupo a 'perfiles'
            // - Portada del grupo a 'portadas'
            const imagen_url = req.files?.foto_perfil ? `${process.env.API_URL}/uploads/perfiles/${req.files.foto_perfil[0].filename}` : null;
            const imagen_portada_url = req.files?.foto_portada ? `${process.env.API_URL}/uploads/portadas/${req.files.foto_portada[0].filename}` : null;

            const [result] = await db.query(
                'INSERT INTO grupos (nombre, descripcion, privacidad, creador_id, imagen_url, imagen_portada_url) VALUES (?, ?, ?, ?, ?, ?)',
                [nombre, descripcion, privacidad || 'publico', creador_id, imagen_url, imagen_portada_url]
            );

            const grupoId = result.insertId;

            // El creador se une automáticamente como administrador (activo)
            await db.query(
                'INSERT INTO grupo_miembros (grupo_id, usuario_id, estado) VALUES (?, ?, "activo")',
                [grupoId, creador_id]
            );

            res.json({ success: true, data: { id: grupoId, nombre }, message: 'Grupo creado exitosamente' });
        } catch (error) {
            console.error('Error al crear grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Unirse a un grupo
    unirseGrupo: async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.usuario.id;

            // Verificar si ya es miembro
            const [miembro] = await db.query(
                'SELECT id FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?',
                [id, usuario_id]
            );

            if (miembro.length > 0) {
                return res.status(400).json({ success: false, message: 'Ya eres miembro o tienes una solicitud pendiente' });
            }

            // Verificar privacidad
            const [grupo] = await db.query('SELECT privacidad FROM grupos WHERE id = ?', [id]);
            const estado = grupo[0].privacidad === 'publico' ? 'activo' : 'pendiente';

            await db.query(
                'INSERT INTO grupo_miembros (grupo_id, usuario_id, estado) VALUES (?, ?, ?)',
                [id, usuario_id, estado]
            );

            res.json({ success: true, message: estado === 'activo' ? 'Te has unido al grupo' : 'Solicitud enviada' });
        } catch (error) {
            console.error('Error al unirse al grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Salir de un grupo
    salirGrupo: async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.usuario.id;

            await db.query(
                'DELETE FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?',
                [id, usuario_id]
            );

            res.json({ success: true, message: 'Has salido del grupo' });
        } catch (error) {
            console.error('Error al salir del grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Obtener detalle de un grupo
    obtenerDetalle: async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.usuario ? req.usuario.id : null;

            const [grupos] = await db.query(`
                SELECT g.*, u.nombre_usuario as creador_nombre,
                (SELECT COUNT(*) FROM grupo_miembros WHERE grupo_id = g.id) as total_miembros,
                (SELECT estado FROM grupo_miembros WHERE grupo_id = g.id AND usuario_id = ?) as mi_estado
                FROM grupos g
                JOIN usuarios u ON g.creador_id = u.id
                WHERE g.id = ?
            `, [usuario_id, id]);

            if (grupos.length === 0) {
                return res.status(404).json({ success: false, message: 'Grupo no encontrado' });
            }

            res.json({ success: true, data: grupos[0] });
        } catch (error) {
            console.error('Error al obtener detalle del grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Obtener publicaciones de un grupo
    obtenerPublicaciones: async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.usuario ? req.usuario.id : null;

            const [publicaciones] = await db.query(
                `SELECT p.*, u.nombre_usuario, u.nombre_completo, u.foto_perfil_url,
                (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id) as total_likes,
                (SELECT COUNT(*) FROM likes WHERE publicacion_id = p.id AND usuario_id = ?) as usuario_dio_like
                FROM publicaciones p
                JOIN usuarios u ON p.usuario_id = u.id
                WHERE p.grupo_id = ?
                ORDER BY p.fecha_creacion DESC`,
                [usuario_id, id]
            );

            res.json({ success: true, data: publicaciones });
        } catch (error) {
            console.error('Error al obtener publicaciones del grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // ================= Invitaciones =================

    // Invitar un usuario al grupo
    invitarUsuario: async (req, res) => {
        try {
            const { id } = req.params; // ID del grupo
            const { usuario_id } = req.body; // Usuario a invitar
            const remitente_id = req.usuario.id;

            // Verificar si ya es miembro
            const [esMiembro] = await db.query(
                'SELECT id FROM grupo_miembros WHERE grupo_id = ? AND usuario_id = ?',
                [id, usuario_id]
            );

            if (esMiembro.length > 0) {
                return res.status(400).json({ success: false, message: 'El usuario ya es miembro de este grupo' });
            }

            // Verificar si ya hay una invitación pendiente
            const [invitacionExiste] = await db.query(
                'SELECT id FROM grupo_invitaciones WHERE grupo_id = ? AND invitado_id = ? AND estado = "pendiente"',
                [id, usuario_id]
            );

            if (invitacionExiste.length > 0) {
                return res.status(400).json({ success: false, message: 'Ya existe una invitación pendiente para este usuario' });
            }

            // Crear invitación
            await db.query(
                'INSERT INTO grupo_invitaciones (grupo_id, remitente_id, invitado_id) VALUES (?, ?, ?)',
                [id, remitente_id, usuario_id]
            );

            // ✅ Notificación
            const [grupoInfo] = await db.query('SELECT nombre FROM grupos WHERE id = ?', [id]);
            await Notificacion.crear(
                usuario_id,
                remitente_id,
                'invitacion_grupo',
                null,
                `Has sido invitado al grupo "${grupoInfo[0].nombre}"`
            );

            res.json({ success: true, message: 'Invitación enviada correctamente' });
        } catch (error) {
            console.error('Error al invitar al grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    },

    // Obtener mis invitaciones pendientes
    obtenerInvitaciones: async (req, res) => {
        try {
            const usuario_id = req.usuario.id;

            const [invitaciones] = await db.query(
                `SELECT i.*, g.nombre as grupo_nombre, g.imagen_url as grupo_imagen, 
                u.nombre_completo as remitente_nombre
                FROM grupo_invitaciones i
                JOIN grupos g ON i.grupo_id = g.id
                JOIN usuarios u ON i.remitente_id = u.id
                WHERE i.invitado_id = ? AND i.estado = "pendiente"`,
                [usuario_id]
            );

            res.json({ success: true, data: invitaciones });
        } catch (error) {
            console.error('❌ Error al obtener invitaciones:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error en el servidor al cargar invitaciones',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined 
            });
        }
    },

    // Responder a una invitación (aceptar/rechazar)
    responderInvitacion: async (req, res) => {
        const connection = await db.getConnection();
        try {
            const { invitacion_id } = req.params;
            const { accion } = req.body; // 'aceptar' o 'rechazar'
            const usuario_id = req.usuario.id;

            await connection.beginTransaction();

            // Verificar invitación
            const [inv] = await connection.query(
                'SELECT * FROM grupo_invitaciones WHERE id = ? AND invitado_id = ? AND estado = "pendiente"',
                [invitacion_id, usuario_id]
            );

            if (inv.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Invitación no encontrada' });
            }

            if (accion === 'aceptar') {
                // Actualizar invitación
                await connection.query(
                    'UPDATE grupo_invitaciones SET estado = "aceptada" WHERE id = ?',
                    [invitacion_id]
                );

                // Unir al grupo
                await connection.query(
                    'INSERT INTO grupo_miembros (grupo_id, usuario_id, estado) VALUES (?, ?, "activo")',
                    [inv[0].grupo_id, usuario_id]
                );
            } else {
                // Rechazar
                await connection.query(
                    'UPDATE grupo_invitaciones SET estado = "rechazada" WHERE id = ?',
                    [invitacion_id]
                );
            }

            await connection.commit();
            res.json({ success: true, message: `Invitación ${accion === 'aceptar' ? 'aceptada' : 'rechazada'} correctamente` });
        } catch (error) {
            await connection.rollback();
            console.error('Error al responder invitación:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        } finally {
            connection.release();
        }
    },

    // Actualizar datos del grupo (incluyendo fotos)
    actualizarGrupo: async (req, res) => {
        try {
            const { id } = req.params;
            const { nombre, descripcion, privacidad } = req.body;
            const usuario_id = req.usuario.id;

            // Verificar si el usuario es el creador o tiene permisos (por ahora solo creador)
            const [grupoAct] = await db.query('SELECT creador_id FROM grupos WHERE id = ?', [id]);
            
            if (grupoAct.length === 0) {
                return res.status(404).json({ success: false, message: 'Grupo no encontrado' });
            }

            if (grupoAct[0].creador_id !== usuario_id) {
                return res.status(403).json({ success: false, message: 'No tienes permiso para editar este grupo' });
            }

            const campos = [];
            const valores = [];

            if (nombre) { campos.push('nombre = ?'); valores.push(nombre); }
            if (descripcion) { campos.push('descripcion = ?'); valores.push(descripcion); }
            if (privacidad) { campos.push('privacidad = ?'); valores.push(privacidad); }

            // Manejo de fotos con Cloudinary
            if (req.files?.foto_perfil) {
                campos.push('imagen_url = ?');
                valores.push(req.files.foto_perfil[0].path);
            }
            if (req.files?.foto_portada) {
                campos.push('imagen_portada_url = ?');
                valores.push(req.files.foto_portada[0].path);
            }

            if (campos.length === 0) {
                return res.json({ success: true, message: 'No hay campos para actualizar' });
            }

            valores.push(id);
            await db.query(`UPDATE grupos SET ${campos.join(', ')} WHERE id = ?`, valores);

            res.json({ success: true, message: 'Grupo actualizado correctamente' });
        } catch (error) {
            console.error('Error al actualizar grupo:', error);
            res.status(500).json({ success: false, message: 'Error en el servidor' });
        }
    }
};

module.exports = grupoController;
