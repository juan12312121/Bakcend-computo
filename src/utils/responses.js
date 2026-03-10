exports.successResponse = (res, data, mensaje = 'Operación exitosa', status = 200) => {
  return res.status(status).json({
    success: true,
    mensaje,
    data
  });
};

exports.errorResponse = (res, mensaje = 'Error en la operación', status = 500, errores = null) => {
  return res.status(status).json({
    success: false,
    mensaje,
    errores
  });
};