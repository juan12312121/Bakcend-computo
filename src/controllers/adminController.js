// src/controllers/adminController.js
const Publicacion = require('../models/Publicacion');
const Usuario = require('../models/Usuario');
const db = require('../config/database');
const logSecurityEvent = require('../utils/securityLogger');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * 📊 List all reports for moderation
 */
exports.obtenerReportes = async (req, res) => {
    try {
        const [reportes] = await db.execute(`
      SELECT r.*, u.nombre_usuario as reportante, p.contenido as post_contenido, p.usuario_id as post_usuario_id
      FROM reportes r
      JOIN usuarios u ON r.usuario_id = u.id
      JOIN publicaciones p ON r.publicacion_id = p.id
      ORDER BY r.fecha_reporte DESC
    `);
        return successResponse(res, reportes, 'Reportes obtenidos correctamente');
    } catch (error) {
        console.error('Error al obtener reportes:', error);
        return errorResponse(res, 'Error al obtener reportes', 500);
    }
};

/**
 * 🗑️ Delete a post by an admin
 */
exports.eliminarPublicacion = async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;

        const post = await Publicacion.buscarPorId(id);
        if (!post) {
            return errorResponse(res, 'Publicación no encontrada', 404);
        }

        await Publicacion.eliminarPorAdmin(id);

        await logSecurityEvent(req.usuario.id, 'ADMIN_DELETE_POST', { postId: id, postOwner: post.usuario_id, motivo }, req);

        return successResponse(res, null, 'Publicación eliminada por moderación');
    } catch (error) {
        console.error('Error al eliminar publicación:', error);
        return errorResponse(res, 'Error al eliminar publicación', 500);
    }
};

/**
 * 🚫 Suspend a user by an admin
 */
exports.suspenderUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;

        const usuario = await Usuario.buscarPorId(id);
        if (!usuario) {
            return errorResponse(res, 'Usuario no encontrado', 404);
        }

        await Usuario.suspender(id);

        await logSecurityEvent(req.usuario.id, 'ADMIN_SUSPEND_USER', { targetUserId: id, motivo }, req);

        return successResponse(res, null, 'Usuario suspendido exitosamente');
    } catch (error) {
        console.error('Error al suspender usuario:', error);
        return errorResponse(res, 'Error al suspender usuario', 500);
    }
};

/**
 * 📝 Get security audit logs (Admin only)
 */
exports.obtenerLogs = async (req, res) => {
    try {
        const [logs] = await db.execute(`
      SELECT l.*, u.nombre_usuario 
      FROM logs_seguridad l
      LEFT JOIN usuarios u ON l.usuario_id = u.id
      ORDER BY l.fecha_creacion DESC
      LIMIT 100
    `);
        return successResponse(res, logs, 'Logs de seguridad obtenidos');
    } catch (error) {
        console.error('Error al obtener logs:', error);
        return errorResponse(res, 'Error al obtener logs', 500);
    }
};
