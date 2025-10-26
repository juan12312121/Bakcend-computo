const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err);
  
  // Error de duplicado en MySQL
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(400).json({
      success: false,
      mensaje: 'Ya existe un registro con esos datos'
    });
  }
  
  // Error de sintaxis SQL
  if (err.code && err.code.startsWith('ER_')) {
    return res.status(500).json({
      success: false,
      mensaje: 'Error en la base de datos'
    });
  }
  
  // Error por defecto
  res.status(err.status || 500).json({
    success: false,
    mensaje: err.message || 'Error interno del servidor',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = errorHandler;
