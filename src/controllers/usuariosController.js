// src/controllers/usuariosController.js
const Usuario = require('../models/Usuario');
const { successResponse, errorResponse } = require('../utils/responses');
const { deleteFromS3 } = require('../config/aws');

// ==================== OBTENER MI PERFIL (USUARIO AUTENTICADO) ====================
exports.obtenerMiPerfil = async (req, res) => {
  try {
    console.log('========== OBTENER MI PERFIL ==========');
    console.log('req.usuario:', req.usuario);

    const usuarioId = req.usuario?.id || req.usuario?.usuario_id;
    if (!usuarioId) return errorResponse(res, 'Usuario no autenticado', 401);

    const usuario = await Usuario.buscarPorId(usuarioId);
    if (!usuario) return errorResponse(res, 'Usuario no encontrado', 404);

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
    if (isNaN(id)) return errorResponse(res, 'ID de usuario inválido', 400);

    const usuario = await Usuario.buscarPorId(id);
    if (!usuario) return errorResponse(res, 'Usuario no encontrado', 404);

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

    if (!usuarioId) return errorResponse(res, 'Usuario no autenticado', 401);

    const datosActualizar = {};
    if (nombre_completo !== undefined) datosActualizar.nombre_completo = nombre_completo;
    if (biografia !== undefined) datosActualizar.biografia = biografia;
    if (ubicacion !== undefined) datosActualizar.ubicacion = ubicacion;
    if (carrera !== undefined) datosActualizar.carrera = carrera;

    // Obtener usuario anterior para comparar / eliminar si procede
    const usuarioAnterior = await Usuario.buscarPorId(usuarioId);

    // Manejar foto de perfil
    if (req.files && req.files.foto_perfil && req.files.foto_perfil.length > 0) {
      const fotoPerfil = req.files.foto_perfil[0];
      datosActualizar.foto_perfil_url = fotoPerfil.location;
      datosActualizar.foto_perfil_s3 = fotoPerfil.key;

      console.log('✅ Foto de perfil guardada en S3:', fotoPerfil.location, fotoPerfil.key);
      // Eliminar anterior solo si existe y es distinta a la nueva
      try {
        if (usuarioAnterior?.foto_perfil_s3 && usuarioAnterior.foto_perfil_s3 !== datosActualizar.foto_perfil_s3) {
          await deleteFromS3(usuarioAnterior.foto_perfil_s3);
          console.log('🗑️ Foto de perfil anterior eliminada de S3');
        }
      } catch (err) {
        console.warn('⚠️ No se pudo eliminar foto de perfil anterior:', err.message || err);
      }
    }

    // Manejar foto de portada
    if (req.files && req.files.foto_portada && req.files.foto_portada.length > 0) {
      const fotoPortada = req.files.foto_portada[0];
      datosActualizar.foto_portada_url = fotoPortada.location;
      datosActualizar.foto_portada_s3 = fotoPortada.key;

      console.log('✅ Foto de portada guardada en S3:', fotoPortada.location, fotoPortada.key);
      try {
        if (usuarioAnterior?.foto_portada_s3 && usuarioAnterior.foto_portada_s3 !== datosActualizar.foto_portada_s3) {
          await deleteFromS3(usuarioAnterior.foto_portada_s3);
          console.log('🗑️ Foto de portada anterior eliminada de S3');
        }
      } catch (err) {
        console.warn('⚠️ No se pudo eliminar foto de portada anterior:', err.message || err);
      }
    }

    if (Object.keys(datosActualizar).length === 0) {
      return errorResponse(res, 'No hay datos para actualizar', 400);
    }

    console.log('💾 Datos a actualizar:', datosActualizar);

    const actualizado = await Usuario.actualizar(usuarioId, datosActualizar);
    if (!actualizado) {
      // limpiar archivos subidos si hay fallo
      if (req.files) {
        try {
          if (req.files.foto_perfil) await deleteFromS3(req.files.foto_perfil[0].key);
        } catch (e) { console.error('Error limpiando foto_perfil:', e); }
        try {
          if (req.files.foto_portada) await deleteFromS3(req.files.foto_portada[0].key);
        } catch (e) { console.error('Error limpiando foto_portada:', e); }
      }
      return errorResponse(res, 'No se pudo actualizar el perfil', 400);
    }

    const usuarioActualizado = await Usuario.buscarPorId(usuarioId);
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

    // Eliminar archivos subidos a S3 si hay error
    if (req.files) {
      try {
        if (req.files.foto_perfil) await deleteFromS3(req.files.foto_perfil[0].key);
      } catch (e) { console.error('Error al limpiar foto de perfil:', e); }
      try {
        if (req.files.foto_portada) await deleteFromS3(req.files.foto_portada[0].key);
      } catch (e) { console.error('Error al limpiar foto de portada:', e); }
    }

    return errorResponse(res, 'Error al actualizar perfil', 500);
  }
};

// ==================== BUSCAR USUARIOS ====================
exports.buscarUsuarios = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return successResponse(res, [], 'Sin resultados');
    }
    if (q.trim().length < 2) {
      return errorResponse(res, 'El término de búsqueda debe tener al menos 2 caracteres', 400);
    }
    const usuarios = await Usuario.buscar(q);
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
    const usuario = await Usuario.buscarPorId(usuarioId);

    if (usuario) {
      if (usuario.foto_perfil_s3) {
        try { await deleteFromS3(usuario.foto_perfil_s3); console.log('✅ Foto de perfil eliminada de S3'); }
        catch (e) { console.error('Error al eliminar foto de perfil:', e); }
      }
      if (usuario.foto_portada_s3) {
        try { await deleteFromS3(usuario.foto_portada_s3); console.log('✅ Foto de portada eliminada de S3'); }
        catch (e) { console.error('Error al eliminar foto de portada:', e); }
      }
    }

    const eliminado = await Usuario.eliminar(usuarioId);
    if (!eliminado) return errorResponse(res, 'No se pudo eliminar la cuenta', 400);

    return successResponse(res, null, 'Cuenta eliminada exitosamente');
  } catch (error) {
    console.error('❌ Error al eliminar cuenta:', error);
    console.error('Stack:', error.stack);
    return errorResponse(res, 'Error al eliminar cuenta', 500);
  }
};


exports.actualizarActividad = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { activo } = req.body;

    // Validar que activo sea 0 o 1
    if (activo !== 0 && activo !== 1) {
      return res.status(400).json({
        success: false,
        mensaje: 'El valor de activo debe ser 0 o 1'
      });
    }

    await Usuario.actualizarActividad(usuarioId, activo);

    res.json({
      success: true,
      mensaje: `Estado actualizado a ${activo === 1 ? 'activo' : 'inactivo'}`,
      data: { activo }
    });

  } catch (error) {
    console.error('❌ Error en actualizarActividad:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar el estado de actividad'
    });
  }
};

// POST /api/usuarios/me/heartbeat
exports.heartbeat = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    await Usuario.registrarHeartbeat(usuarioId);

    res.json({
      success: true,
      mensaje: 'Heartbeat recibido',
      data: { 
        activo: 1,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Error en heartbeat:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al procesar heartbeat'
    });
  }
};

// GET /api/usuarios/activos
exports.obtenerUsuariosActivos = async (req, res) => {
  try {
    const usuarios = await Usuario.obtenerActivos();

    res.json({
      success: true,
      mensaje: 'Usuarios activos obtenidos',
      data: usuarios
    });

  } catch (error) {
    console.error('❌ Error en obtenerUsuariosActivos:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener usuarios activos'
    });
  }
};

exports.obtenerSeguidoresActivos = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    
    console.log('🎯 [CONTROLLER] obtenerSeguidoresActivos iniciado');
    console.log('👤 [CONTROLLER] Usuario autenticado:', {
      id: usuarioId,
      email: req.usuario.email,
      nombre: req.usuario.nombre_usuario
    });

    const seguidores = await Usuario.obtenerSeguidoresActivos(usuarioId);

    console.log('✅ [CONTROLLER] Seguidores obtenidos:', {
      cantidad: seguidores.length,
      usuarioId: usuarioId
    });

    res.json({
      success: true,
      mensaje: `${seguidores.length} seguidores activos encontrados`,
      data: seguidores
    });

  } catch (error) {
    console.error('❌ [CONTROLLER] Error en obtenerSeguidoresActivos:', error);
    console.error('❌ [CONTROLLER] Stack:', error.stack);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener seguidores activos'
    });
  }
};