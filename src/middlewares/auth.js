// middlewares/auth.js

const jwt = require('jsonwebtoken');

const proteger = async (req, res, next) => {
  console.log('');
  console.log('🔐 ===================================');
  console.log('🔐 MIDDLEWARE DE AUTENTICACIÓN');
  console.log('🔐 ===================================');
  console.log('📍 Ruta:', req.method, req.originalUrl);
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));

  try {
    const authHeader = req.headers.authorization;
    console.log('🔑 Authorization header:', authHeader ? '✅ Presente' : '❌ Ausente');

    if (!authHeader) {
      console.log('❌ No hay token de autorización');
      console.log('🔐 ===================================');
      console.log('');
      return res.status(401).json({
        success: false,
        mensaje: 'No autorizado - Token no proporcionado'
      });
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    console.log('🔍 Token extraído:', token.substring(0, 20) + '...');

    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET no está configurado');
      console.log('🔐 ===================================');
      console.log('');
      return res.status(500).json({
        success: false,
        mensaje: 'Error de configuración del servidor'
      });
    }

    console.log('🔓 Verificando token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token válido');
    console.log('👤 Usuario ID:', decoded.id);
    console.log('👤 Email:', decoded.email);

    req.usuario = decoded;

    console.log('✅ Autenticación exitosa - Pasando al siguiente middleware');
    console.log('🔐 ===================================');
    console.log('');

    next();

  } catch (error) {
    console.error('');
    console.error('❌ ===================================');
    console.error('❌ ERROR EN AUTENTICACIÓN');
    console.error('❌ ===================================');
    console.error('Tipo de error:', error.name);
    console.error('Mensaje:', error.message);

    if (error.name === 'TokenExpiredError') {
      console.error('⏰ El token ha expirado');
      console.error('Expiró en:', error.expiredAt);
    } else if (error.name === 'JsonWebTokenError') {
      console.error('🔒 Token inválido o malformado');
    }

    console.error('Stack:', error.stack);
    console.error('❌ ===================================');
    console.error('');

    return res.status(401).json({
      success: false,
      mensaje: error.name === 'TokenExpiredError'
        ? 'Token expirado - Por favor inicia sesión nuevamente'
        : 'Token inválido - No autorizado'
    });
  }
};

const opcional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.usuario = decoded;
    }
    next();
  } catch (error) {
    next();
  }
};

const soloAdmin = (req, res, next) => {
  if (req.usuario && (req.usuario.rol === 'admin')) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      mensaje: 'Acceso denegado - Se requieren privilegios de administrador'
    });
  }
};

module.exports = { proteger, opcional, soloAdmin };