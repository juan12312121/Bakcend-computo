const Usuario = require('../models/Usuario');
const { successResponse, errorResponse } = require('../utils/responses');

// Obtener perfil de usuario
exports.obtenerPerfil = async (req, res) => {
  try {
    const { id } = req.params;
    
    const usuario = await Usuario.buscarPorId(id);
    
    if (!usuario) {
      return errorResponse(res, 'Usuario no encontrado', 404);
    }
    
    return successResponse(res, usuario, 'Perfil obtenido exitosamente');
    
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    return errorResponse(res, 'Error al obtener perfil del usuario', 500);
  }
};

// Obtener mi perfil (usuario autenticado)
exports.obtenerMiPerfil = async (req, res) => {
  try {
    const usuario = await Usuario.buscarPorId(req.usuario.id);
    
    if (!usuario) {
      return errorResponse(res, 'Usuario no encontrado', 404);
    }
    
    return successResponse(res, usuario, 'Perfil obtenido exitosamente');
    
  } catch (error) {
    console.error('Error al obtener mi perfil:', error);
    return errorResponse(res, 'Error al obtener perfil', 500);
  }
};

// Actualizar perfil (completar información adicional)
exports.actualizarPerfil = async (req, res) => {
  try {
    const { nombre_completo, biografia, ubicacion, carrera } = req.body;
    
    // Crear objeto solo con los campos que fueron enviados
    const datosActualizar = {};
    
    if (nombre_completo !== undefined) datosActualizar.nombre_completo = nombre_completo;
    if (biografia !== undefined) datosActualizar.biografia = biografia;
    if (ubicacion !== undefined) datosActualizar.ubicacion = ubicacion;
    if (carrera !== undefined) datosActualizar.carrera = carrera;
    
    // Verificar que al menos un campo fue enviado
    if (Object.keys(datosActualizar).length === 0) {
      return errorResponse(res, 'No hay datos para actualizar', 400);
    }
    
    const actualizado = await Usuario.actualizar(req.usuario.id, datosActualizar);
    
    if (!actualizado) {
      return errorResponse(res, 'No se pudo actualizar el perfil', 400);
    }
    
    const usuarioActualizado = await Usuario.buscarPorId(req.usuario.id);
    
    return successResponse(res, usuarioActualizado, 'Perfil actualizado exitosamente');
    
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    return errorResponse(res, 'Error al actualizar perfil', 500);
  }
};

// Buscar usuarios
exports.buscarUsuarios = async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return errorResponse(res, 'El término de búsqueda debe tener al menos 2 caracteres', 400);
    }
    
    const usuarios = await Usuario.buscar(q);
    
    return successResponse(res, usuarios, `${usuarios.length} usuarios encontrados`);
    
  } catch (error) {
    console.error('Error al buscar usuarios:', error);
    return errorResponse(res, 'Error al buscar usuarios', 500);
  }
};

// Eliminar cuenta
exports.eliminarCuenta = async (req, res) => {
  try {
    const eliminado = await Usuario.eliminar(req.usuario.id);
    
    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar la cuenta', 400);
    }
    
    return successResponse(res, null, 'Cuenta eliminada exitosamente');
    
  } catch (error) {
    console.error('Error al eliminar cuenta:', error);
    return errorResponse(res, 'Error al eliminar cuenta', 500);
  }
};