const jwt = require('jsonwebtoken');

const proteger = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, mensaje: 'No hay token' });
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, mensaje: 'Token inválido' });
  }
};

const opcional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (error) {
    next();
  }
};

const soloAdmin = (req, res, next) => {
  if (req.usuario && (req.usuario.rol === 'admin' || req.usuario.es_admin)) return next();
  res.status(403).json({ success: false, mensaje: 'Acceso denegado' });
};

module.exports = { proteger, opcional, soloAdmin };