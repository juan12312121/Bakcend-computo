const Usuario = require('../models/Usuario');
const { successResponse, errorResponse } = require('../utils/responses');
const fs = require('fs');
const path = require('path');

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

// Actualizar perfil (completar información adicional + imágenes)
exports.actualizarPerfil = async (req, res) => {
  try {
    const { nombre_completo, biografia, ubicacion, carrera } = req.body;
    
    console.log('📥 Datos recibidos:', {
      nombre_completo,
      biografia,
      ubicacion,
      carrera,
      archivos: req.files
    });
    
    // Crear objeto solo con los campos que fueron enviados
    const datosActualizar = {};
    
    if (nombre_completo !== undefined) datosActualizar.nombre_completo = nombre_completo;
    if (biografia !== undefined) datosActualizar.biografia = biografia;
    if (ubicacion !== undefined) datosActualizar.ubicacion = ubicacion;
    if (carrera !== undefined) datosActualizar.carrera = carrera;
    
    // 🔥 Manejar foto de perfil
    if (req.files && req.files.foto_perfil) {
      const fotoPerfil = req.files.foto_perfil[0];
      datosActualizar.foto_perfil_url = `/uploads/perfiles/${fotoPerfil.filename}`;
      console.log('✅ Foto de perfil:', datosActualizar.foto_perfil_url);
      
      // Opcional: Eliminar foto anterior
      try {
        const usuarioAnterior = await Usuario.buscarPorId(req.usuario.id);
        if (usuarioAnterior?.foto_perfil_url) {
          const rutaAnterior = path.join(__dirname, '..', usuarioAnterior.foto_perfil_url);
          if (fs.existsSync(rutaAnterior)) {
            fs.unlinkSync(rutaAnterior);
            console.log('🗑️ Foto de perfil anterior eliminada');
          }
        }
      } catch (error) {
        console.log('⚠️ No se pudo eliminar foto anterior:', error.message);
      }
    }
    
    // 🔥 Manejar foto de portada
    if (req.files && req.files.foto_portada) {
      const fotoPortada = req.files.foto_portada[0];
      datosActualizar.foto_portada_url = `/uploads/portadas/${fotoPortada.filename}`;
      console.log('✅ Foto de portada:', datosActualizar.foto_portada_url);
      
      // Opcional: Eliminar portada anterior
      try {
        const usuarioAnterior = await Usuario.buscarPorId(req.usuario.id);
        if (usuarioAnterior?.foto_portada_url) {
          const rutaAnterior = path.join(__dirname, '..', usuarioAnterior.foto_portada_url);
          if (fs.existsSync(rutaAnterior)) {
            fs.unlinkSync(rutaAnterior);
            console.log('🗑️ Foto de portada anterior eliminada');
          }
        }
      } catch (error) {
        console.log('⚠️ No se pudo eliminar portada anterior:', error.message);
      }
    }
    
    // Verificar que al menos un campo fue enviado
    if (Object.keys(datosActualizar).length === 0) {
      return errorResponse(res, 'No hay datos para actualizar', 400);
    }
    
    console.log('💾 Datos a actualizar:', datosActualizar);
    
    const actualizado = await Usuario.actualizar(req.usuario.id, datosActualizar);
    
    if (!actualizado) {
      // Si hay error, eliminar archivos subidos
      if (req.files) {
        if (req.files.foto_perfil) {
          try {
            fs.unlinkSync(req.files.foto_perfil[0].path);
          } catch (e) {}
        }
        if (req.files.foto_portada) {
          try {
            fs.unlinkSync(req.files.foto_portada[0].path);
          } catch (e) {}
        }
      }
      return errorResponse(res, 'No se pudo actualizar el perfil', 400);
    }
    
    const usuarioActualizado = await Usuario.buscarPorId(req.usuario.id);
    
    console.log('✅ Perfil actualizado:', {
      id: usuarioActualizado.id,
      nombre: usuarioActualizado.nombre_completo,
      foto_perfil_url: usuarioActualizado.foto_perfil_url,
      foto_portada_url: usuarioActualizado.foto_portada_url
    });
    
    return successResponse(res, usuarioActualizado, 'Perfil actualizado exitosamente');
    
  } catch (error) {
    console.error('❌ Error al actualizar perfil:', error);
    
    // Eliminar archivos subidos si hay error
    if (req.files) {
      if (req.files.foto_perfil) {
        try {
          fs.unlinkSync(req.files.foto_perfil[0].path);
        } catch (e) {}
      }
      if (req.files.foto_portada) {
        try {
          fs.unlinkSync(req.files.foto_portada[0].path);
        } catch (e) {}
      }
    }
    
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