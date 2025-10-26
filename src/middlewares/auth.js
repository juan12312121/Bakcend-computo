const jwt = require('jsonwebtoken');
const { errorResponse } = require('../utils/responses');

exports.proteger = async (req, res, next) => {
  try {
    let token;
    
    // Obtener token del header Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    // Verificar si existe el token
    if (!token) {
      return errorResponse(res, 'No autorizado. Token no proporcionado', 401);
    }
    
    // Verificar token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Agregar usuario al request
    req.usuario = decoded;
    
    next();
    
  } catch (error) {
    console.error('Error en autenticación:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return errorResponse(res, 'Token inválido', 401);
    }
    if (error.name === 'TokenExpiredError') {
      return errorResponse(res, 'Token expirado', 401);
    }
    
    return errorResponse(res, 'No autorizado', 401);
  }
};