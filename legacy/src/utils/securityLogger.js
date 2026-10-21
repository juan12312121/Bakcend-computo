// src/utils/securityLogger.js
const db = require('../config/database');

/**
 * 🛡️ Utility to log security events
 * @param {number|null} usuarioId - The ID of the user involved
 * @param {string} evento - The name of the event (e.g., 'LOGIN_FAILED', 'ADMIN_DELETE_POST')
 * @param {object|string} detalles - Additional details in JSON or string
 * @param {object} req - Express request object to capture IP and User-Agent
 */
const logSecurityEvent = async (usuarioId, evento, detalles, req = null) => {
    try {
        const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null;
        const userAgent = req ? req.headers['user-agent'] : null;
        const detallesStr = typeof detalles === 'object' ? JSON.stringify(detalles) : detalles;

        await db.execute(
            'INSERT INTO logs_seguridad (usuario_id, evento, detalles, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
            [usuarioId, evento, detallesStr, ip, userAgent]
        );
    } catch (error) {
        console.error('❌ Error saving security log:', error.message);
    }
};

module.exports = logSecurityEvent;
