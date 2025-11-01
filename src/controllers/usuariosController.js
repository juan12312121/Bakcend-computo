const Usuario = require('../models/Usuario');
const { successResponse, errorResponse } = require('../utils/responses');
const fs = require('fs');
const path = require('path');

// ==================== OBTENER MI PERFIL (USUARIO AUTENTICADO) ====================
exports.obtenerMiPerfil = async (req, res) => {
  try {
    console.log('========== OBTENER MI PERFIL ==========');
    console.log('req.usuario:', req.usuario);
    
    // Obtener ID del usuario desde el token
    const usuarioId = req.usuario?.id || req.usuario?.usuario_id;
    
    if (!usuarioId) {
      console.error('❌ No se encontró ID de usuario en el token');
      return errorResponse(res, 'Usuario no autenticado', 401);
    }

    console.log('🔍 Buscando usuario con ID:', usuarioId);

    // Buscar usuario por ID
    const usuario = await Usuario.buscarPorId(usuarioId);
    
    if (!usuario) {
      console.error('❌ Usuario no encontrado con ID:', usuarioId);
      return errorResponse(res, 'Usuario no encontrado', 404);
    }

    console.log('✅ Perfil encontrado:', usuario.nombre_usuario);

    // Remover información sensible
    delete usuario.contrasena;
    delete usuario.password;
    
    return successResponse(res, usuario, 'Perfil obtenido exitosamente');
    
  } catch (error) {
    console.error('❌ Error al obtener mi perfil:', error);
    console.error('Stack:', error.stack);
    
    return errorResponse(res, 'Error al obtener perfil', 500);
  }
};

// ==================== OBTENER PERFIL POR ID ====================
exports.obtenerPerfil = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 Obteniendo perfil del usuario ID:', id);

    // Validar que el ID sea un número
    if (isNaN(id)) {
      return errorResponse(res, 'ID de usuario inválido', 400);
    }

    // Buscar usuario por ID
    const usuario = await Usuario.buscarPorId(id);
    
    if (!usuario) {
      return errorResponse(res, 'Usuario no encontrado', 404);
    }

    console.log('✅ Perfil encontrado:', usuario.nombre_usuario);

    // Remover información sensible
    delete usuario.contrasena;
    delete usuario.password;
    
    return successResponse(res, usuario, 'Perfil obtenido exitosamente');
    
  } catch (error) {
    console.error('❌ Error al obtener perfil:', error);
    console.error('Stack:', error.stack);
    
    return errorResponse(res, 'Error al obtener perfil del usuario', 500);
  }
};

// ==================== ACTUALIZAR PERFIL ====================
exports.actualizarPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || req.usuario?.usuario_id;
    const { nombre_completo, biografia, ubicacion, carrera } = req.body;
    
    console.log('📥 Datos recibidos para actualizar:', {
      usuarioId,
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
      
      // ✅ CAMBIO: YA NO ELIMINAMOS la foto anterior
      console.log('📸 Nueva foto de perfil guardada (foto anterior mantenida)');
      
      /* CÓDIGO ANTERIOR QUE ELIMINABA LA FOTO - AHORA COMENTADO
      try {
        const usuarioAnterior = await Usuario.buscarPorId(usuarioId);
        if (usuarioAnterior?.foto_perfil_url && !usuarioAnterior.foto_perfil_url.includes('ui-avatars.com')) {
          const rutaAnterior = path.join(__dirname, '..', usuarioAnterior.foto_perfil_url);
          if (fs.existsSync(rutaAnterior)) {
            fs.unlinkSync(rutaAnterior);
            console.log('🗑️ Foto de perfil anterior eliminada');
          }
        }
      } catch (error) {
        console.log('⚠️ No se pudo eliminar foto anterior:', error.message);
      }
      */
    }
    
    // 🔥 Manejar foto de portada
    if (req.files && req.files.foto_portada) {
      const fotoPortada = req.files.foto_portada[0];
      datosActualizar.foto_portada_url = `/uploads/portadas/${fotoPortada.filename}`;
      console.log('✅ Foto de portada:', datosActualizar.foto_portada_url);
      
      // ✅ CAMBIO: YA NO ELIMINAMOS la foto anterior
      console.log('📸 Nueva foto de portada guardada (foto anterior mantenida)');
      
      /* CÓDIGO ANTERIOR QUE ELIMINABA LA FOTO - AHORA COMENTADO
      try {
        const usuarioAnterior = await Usuario.buscarPorId(usuarioId);
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
      */
    }
    
    // Verificar que al menos un campo fue enviado
    if (Object.keys(datosActualizar).length === 0) {
      return errorResponse(res, 'No hay datos para actualizar', 400);
    }
    
    console.log('💾 Datos a actualizar:', datosActualizar);
    
    const actualizado = await Usuario.actualizar(usuarioId, datosActualizar);
    
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
    
    const usuarioActualizado = await Usuario.buscarPorId(usuarioId);
    
    // Remover información sensible
    delete usuarioActualizado.contrasena;
    delete usuarioActualizado.password;
    
    console.log('✅ Perfil actualizado:', {
      id: usuarioActualizado.id,
      nombre: usuarioActualizado.nombre_completo,
      foto_perfil_url: usuarioActualizado.foto_perfil_url,
      foto_portada_url: usuarioActualizado.foto_portada_url
    });
    
    return successResponse(res, usuarioActualizado, 'Perfil actualizado exitosamente');
    
  } catch (error) {
    console.error('❌ Error al actualizar perfil:', error);
    console.error('Stack:', error.stack);
    
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

// ==================== BUSCAR USUARIOS ====================
exports.buscarUsuarios = async (req, res) => {
  try {
    const { q } = req.query;
    
    console.log('🔍 Búsqueda recibida:', q);
    
    // Validar parámetro
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return successResponse(res, [], 'Sin resultados');
    }

    // Validar longitud mínima
    if (q.trim().length < 2) {
      return errorResponse(res, 'El término de búsqueda debe tener al menos 2 caracteres', 400);
    }

    // Buscar usuarios
    const usuarios = await Usuario.buscar(q);
    
    console.log('✅ Usuarios encontrados:', usuarios.length);
    
    return successResponse(res, usuarios, `${usuarios.length} usuarios encontrados`);
    
  } catch (error) {
    console.error('❌ Error al buscar usuarios:', error);
    console.error('Stack:', error.stack);
    
    return errorResponse(res, 'Error al buscar usuarios', 500);
  }
};

// ==================== ELIMINAR CUENTA ====================
exports.eliminarCuenta = async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || req.usuario?.usuario_id;
    
    console.log('🗑️ Eliminando cuenta del usuario ID:', usuarioId);
    
    const eliminado = await Usuario.eliminar(usuarioId);
    
    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar la cuenta', 400);
    }
    
    console.log('✅ Cuenta eliminada exitosamente');
    
    return successResponse(res, null, 'Cuenta eliminada exitosamente');
    
  } catch (error) {
    console.error('❌ Error al eliminar cuenta:', error);
    console.error('Stack:', error.stack);
    
    return errorResponse(res, 'Error al eliminar cuenta', 500);
  }
};