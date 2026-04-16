const Publicacion = require('../models/Publicacion');
const Documento = require('../models/Documento');
const Notificacion = require('../models/Notificacion');
const CensuraPublicaciones = require('../services/CensuraPublicaciones');
const { deleteFile, getUrl } = require('../config/multer');
const { successResponse, errorResponse } = require('../utils/responses');

const baseUrl = process.env.API_URL || 'https://bakcend-computo-1.onrender.com';

/**
 * ============================================
 * CONTROLADOR DE PUBLICACIONES CON CENSURA + DOCUMENTOS + VISIBILIDAD
 * ============================================
 */

/**
 * OBTENER CATEGORÍAS DISPONIBLES
 * GET /api/publicaciones/categorias
 */
exports.obtenerCategorias = async (req, res) => {
  try {
    const categorias = Publicacion.getCategorias();
    return successResponse(res, categorias, 'Lista de categorías disponibles');
  } catch (error) {
    return errorResponse(res, 'Error al obtener categorías', 500);
  }
};

/**
 * OBTENER OPCIONES DE VISIBILIDAD
 * GET /api/publicaciones/visibilidades
 */
exports.obtenerVisibilidades = async (req, res) => {
  try {
    const visibilidades = Publicacion.getVisibilidades();
    return successResponse(res, visibilidades, 'Opciones de visibilidad disponibles');
  } catch (error) {
    return errorResponse(res, 'Error al obtener visibilidades', 500);
  }
};

/**
 * 🆕 CREAR PUBLICACIÓN - CON IMAGEN, DOCUMENTOS Y VISIBILIDAD
 * POST /api/publicaciones
 */
exports.crearPublicacion = async (req, res) => {
  let imagenSubida = false;
  let documentosSubidos = [];
  
  try {
    const { contenido, categoria, visibilidad, grupo_id } = req.body;

    // Validar contenido
    if (!contenido || contenido.trim().length === 0) {
      if (req.files?.imagen?.[0]) await deleteFile(req.files.imagen[0].filename).catch(() => {});
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
      }
      return errorResponse(res, 'El contenido es obligatorio', 400);
    }

    if (contenido.length > 5000) {
      if (req.files?.imagen?.[0]) await deleteFile(req.files.imagen[0].filename).catch(() => {});
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
      }
      return errorResponse(res, 'La publicación no puede exceder 5000 caracteres', 400);
    }

    // Validar categoría
    const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
    if (categoria && !categoriasValidas.includes(categoria)) {
      if (req.files?.imagen?.[0]) await deleteFile(req.files.imagen[0].filename).catch(() => {});
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
      }
      return errorResponse(res, `Categoría inválida`, 400);
    }

    // Validar visibilidad
    const visibilidadesValidas = ['publico', 'privado', 'seguidores'];
    const visibilidadFinal = visibilidad || 'publico';
    
    if (!visibilidadesValidas.includes(visibilidadFinal)) {
      if (req.files?.imagen?.[0]) await deleteFile(req.files.imagen[0].filename).catch(() => {});
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
      }
      return errorResponse(res, `Visibilidad inválida`, 400);
    }

    // 🔍 ANÁLISIS DE CENSURA - CONTENIDO
    const analisisContenido = await CensuraPublicaciones.validarContenido(
      contenido, 
      categoria || 'General'
    );

    if (!analisisContenido.valido || analisisContenido.accion === 'rechazar') {
      if (req.files?.imagen?.[0]) await deleteFile(req.files.imagen[0].filename).catch(() => {});
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
      }
      return errorResponse(res, `Tu publicación fue rechazada: ${analisisContenido.razon}`, 403);
    }

    if (req.files?.imagen?.[0]) {
      imagenSubida = true;
    }

    // 🔍 ANÁLISIS DE CENSURA - IMAGEN
    if (req.files?.imagen?.[0]) {
      analisisImagen = await CensuraPublicaciones.validarImagenDescripcion(
        req.files.imagen[0].path,
        contenido
      );

      if (!analisisImagen.apropiada || analisisImagen.accion === 'rechazar') {
        await deleteFile(req.files.imagen[0].filename).catch(() => {});
        if (req.files?.documentos) {
          for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
        }
        return errorResponse(res, `Tu imagen fue rechazada: ${analisisImagen.razon}`, 403);
      }
    }

    // Generar reporte de censura
    const reporte = await CensuraPublicaciones.generarReporte(
      null,
      req.usuario.id,
      analisisContenido,
      analisisImagen
    );

    let requiereRevision = false;
    if (reporte.estadoFinal.estado === 'REQUIERE_REVISION') {
      requiereRevision = true;
    }

    // 📝 CREAR PUBLICACIÓN EN BD CON VISIBILIDAD Y GRUPO
    const imagenId = req.files?.imagen?.[0]?.filename || null;
    const nuevaPublicacionId = await Publicacion.crear({
      usuario_id: req.usuario.id,
      contenido,
      imagen_url: req.files?.imagen?.[0]?.path || null,
      imagen_s3: imagenId,
      categoria: categoria || 'General',
      visibilidad: visibilidadFinal,
      grupo_id: grupo_id || null,
      requiere_revision: requiereRevision ? 1 : 0,
      analisis_censura: JSON.stringify(reporte)
    });

    // 🆕 GUARDAR DOCUMENTOS EN BD
    if (req.files?.documentos && req.files.documentos.length > 0) {
      for (const doc of req.files.documentos) {
        try {
          const { icono, color } = Documento.obtenerIconoYColor(doc.mimetype);
          
          const documentoId = await Documento.crear({
            usuario_id: req.usuario.id,
            publicacion_id: nuevaPublicacionId,
            documento_url: doc.path,
            documento_s3: doc.filename, // public_id en Cloudinary
            nombre_archivo: doc.originalname,
            tamano_archivo: doc.size,
            tipo_archivo: doc.mimetype,
            icono,
            color
          });

          documentosSubidos.push({
            id: documentoId,
            location: doc.path
          });

          console.log(`✅ Documento ${documentoId} vinculado a publicación ${nuevaPublicacionId}`);
        } catch (docError) {
          console.error('❌ Error al guardar documento:', docError);
        }
      }
    }

    // Obtener publicación completa con documentos
    const publicacion = await Publicacion.obtenerPorId(nuevaPublicacionId, req.usuario.id);

    // 🆕 Emitir evento de nueva publicación por Socket.IO
    if (global.io) {
      if (publicacion.grupo_id) {
        global.io.to(`group_${publicacion.grupo_id}`).emit('new_post', publicacion);
      } else {
        global.io.emit('new_post', publicacion);
      }
    }

    return successResponse(
      res, 
      {
        ...publicacion,
        advertencia: requiereRevision ? 'Tu publicación está siendo revisada por un moderador' : null,
        documentos_adjuntos: documentosSubidos.length
      }, 
      'Publicación creada exitosamente', 
      201
    );

  } catch (error) {
    console.error('❌ Error al crear publicación:', error);

    if (req.files?.imagen?.[0]) await deleteFile(req.files.imagen[0].filename).catch(() => {});
    if (req.files?.documentos) {
      for (const doc of req.files.documentos) await deleteFile(doc.filename).catch(() => {});
    }
    
    return errorResponse(res, 'Error al crear publicación', 500);
  }
};

/**
 * OBTENER PUBLICACIONES (FEED) - CON RESPETO A VISIBILIDAD
 * GET /api/publicaciones
 */
exports.obtenerPublicaciones = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    let publicaciones;

    if (!req.usuario || !req.usuario.id) {
      publicaciones = await Publicacion.obtenerAleatorias(limit);
      return successResponse(res, publicaciones, 'Publicaciones públicas');
    }

    try {
      publicaciones = await Publicacion.obtenerTodasParaUsuario(req.usuario.id, page, limit);
      
      if (!publicaciones || publicaciones.length === 0) {
        if (page === 1) {
          publicaciones = await Publicacion.obtenerAleatorias(limit);
          return successResponse(res, publicaciones, 'Publicaciones aleatorias');
        }
        return successResponse(res, [], 'No hay más publicaciones');
      }

      return successResponse(res, publicaciones, 'Feed personalizado');
      
    } catch (feedError) {
      // ... rest of logic ...
      publicaciones = await Publicacion.obtenerTodas(req.usuario.id);
      
      if (!publicaciones || publicaciones.length === 0) {
        return successResponse(res, [], 'No hay publicaciones disponibles');
      }
      
      return successResponse(res, publicaciones, 'Todas las publicaciones');
    }
    
  } catch (error) {
    try {
      const publicacionesBackup = await Publicacion.obtenerTodas(req.usuario?.id, page, limit);
      return successResponse(res, publicacionesBackup || [], 'Publicaciones (modo backup)');
    } catch (backupError) {
      return errorResponse(res, 'Error al obtener publicaciones', 500);
    }
  }
};

/**
 * OBTENER UNA PUBLICACIÓN POR ID - CON VALIDACIÓN DE VISIBILIDAD
 * GET /api/publicaciones/:id
 */
exports.obtenerPublicacion = async (req, res) => {
  try {
    const { id } = req.params;
    const usuarioActualId = req.usuario?.id || null;
    
    const publicacion = await Publicacion.obtenerPorId(id, usuarioActualId);

    if (!publicacion) {
      return errorResponse(res, 'Publicación no encontrada o no tienes permiso para verla', 404);
    }

    return successResponse(res, publicacion, 'Publicación encontrada');
  } catch (error) {
    return errorResponse(res, 'Error al obtener publicación', 500);
  }
};

/**
 * OBTENER MIS PUBLICACIONES
 * GET /api/publicaciones/mis-publicaciones
 */
exports.obtenerMisPublicaciones = async (req, res) => {
  try {
    const publicaciones = await Publicacion.obtenerPorUsuario(req.usuario.id, req.usuario.id);
    
    return successResponse(
      res, 
      publicaciones, 
      publicaciones.length > 0 ? 'Mis publicaciones' : 'No tienes publicaciones aún'
    );
  } catch (error) {
    return errorResponse(res, 'Error al obtener mis publicaciones', 500);
  }
};

/**
 * OBTENER PUBLICACIONES DE OTRO USUARIO - CON RESPETO A VISIBILIDAD
 * GET /api/publicaciones/usuario/:usuarioId
 */
exports.obtenerPublicacionesUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const usuarioActualId = req.usuario?.id || null;
    
    const publicaciones = await Publicacion.obtenerPorUsuario(usuarioId, usuarioActualId);
    return successResponse(res, publicaciones, 'Publicaciones del usuario');
  } catch (error) {
    return errorResponse(res, 'Error al obtener publicaciones del usuario', 500);
  }
};

/**
 * ACTUALIZAR PUBLICACIÓN - CON VISIBILIDAD
 * PUT /api/publicaciones/:id
 */
exports.actualizarPublicacion = async (req, res) => {
  let imagenSubida = false;

  try {
    const { id } = req.params;
    const { contenido, categoria, visibilidad } = req.body;

    const publicacionActual = await Publicacion.obtenerPorId(id, req.usuario.id);
    if (!publicacionActual) {
      if (req.file) {
        await deleteFile(req.file.filename).catch(() => {});
      }
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    if (publicacionActual.usuario_id !== req.usuario.id) {
      if (req.file) {
        await deleteFile(req.file.filename).catch(() => {});
      }
      return errorResponse(res, 'No tienes permiso para actualizar esta publicación', 403);
    }

    if (contenido && contenido.length > 5000) {
      if (req.file) {
        await deleteFile(req.file.filename).catch(() => {});
      }
      return errorResponse(res, 'La publicación no puede exceder 5000 caracteres', 400);
    }

    if (categoria) {
      const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
      if (!categoriasValidas.includes(categoria)) {
        if (req.file) {
          await deleteFile(req.file.filename).catch(() => {});
        }
        return errorResponse(res, `Categoría inválida`, 400);
      }
    }

    // Validar visibilidad
    if (visibilidad) {
      const visibilidadesValidas = ['publico', 'privado', 'seguidores'];
      if (!visibilidadesValidas.includes(visibilidad)) {
        if (req.file) {
          await deleteFile(req.file.filename).catch(() => {});
        }
        return errorResponse(res, 'Visibilidad inválida', 400);
      }
    }

    if (contenido) {
      const analisisContenido = await CensuraPublicaciones.validarContenido(
        contenido,
        categoria || 'General'
      );

      if (!analisisContenido.valido) {
        if (req.file) await deleteFile(req.file.filename).catch(() => {});
        return errorResponse(
          res,
          `Tu contenido actualizado es inapropiado: ${analisisContenido.razon}`,
          403
        );
      }
    }

    if (req.file) {
      imagenSubida = true;
      const analisisImagen = await CensuraPublicaciones.validarImagenDescripcion(
        req.file.path,
        contenido || publicacionActual.contenido
      );

      if (!analisisImagen.apropiada || analisisImagen.accion === 'rechazar') {
        await deleteFile(req.file.filename).catch(() => {});
        
        return errorResponse(
          res,
          `Tu imagen actualizada es inapropiado: ${analisisImagen.razon}`,
          403
        );
      }
    }

    const datosActualizar = {};
    if (contenido) datosActualizar.contenido = contenido;
    if (categoria) datosActualizar.categoria = categoria;
    if (visibilidad) datosActualizar.visibilidad = visibilidad;
    
    if (req.file) {
      if (publicacionActual.imagen_s3) {
        await deleteFile(publicacionActual.imagen_s3).catch(() => {});
      }
      datosActualizar.imagen_s3 = req.file.filename;
      datosActualizar.imagen_url = req.file.path;
    }

    const actualizado = await Publicacion.actualizar(id, req.usuario.id, datosActualizar);

    if (!actualizado) {
      if (req.file) await deleteFile(req.file.filename).catch(() => {});
      return errorResponse(res, 'No se pudo actualizar la publicación', 400);
    }

    const publicacionActualizada = await Publicacion.obtenerPorId(id, req.usuario.id);

    // 🆕 Emitir evento de actualización
    if (global.io) {
      global.io.emit('update_post', publicacionActualizada);
    }

    return successResponse(res, publicacionActualizada, 'Publicación actualizada correctamente');

  } catch (error) {
    if (req.file) await deleteFile(req.file.filename).catch(() => {});
    
    return errorResponse(res, 'Error al actualizar publicación', 500);
  }
};


exports.obtenerDocumentosUsuario = async (req, res) => {
  try {
    const { usuario_id } = req.params;

    console.log('📄 Obteniendo documentos del usuario:', usuario_id);

    const documentos = await Documento.obtenerPorUsuario(usuario_id);

    console.log('✅ Documentos encontrados:', documentos.length);

    return successResponse(
      res,
      documentos,
      documentos.length > 0 ? `${documentos.length} documento(s) encontrado(s)` : 'Este usuario no tiene documentos'
    );
  } catch (error) {
    console.error('❌ Error al obtener documentos del usuario:', error);
    return errorResponse(res, 'Error al obtener los documentos del usuario', 500);
  }
};

/**
 * 🆕 ELIMINAR PUBLICACIÓN (con documentos)
 * DELETE /api/publicaciones/:id
 */
exports.eliminarPublicacion = async (req, res) => {
  try {
    const { id } = req.params;

    const publicacion = await Publicacion.obtenerPorId(id, req.usuario.id);
    
    if (!publicacion) {
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    if (publicacion.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'No tienes permiso para eliminar esta publicación', 403);
    }

    // Eliminar imagen de S3
    if (publicacion.imagen_s3) {
      await deleteFile(publicacion.imagen_s3).catch(() => {});
    }

    if (publicacion.documentos && publicacion.documentos.length > 0) {
      for (const doc of publicacion.documentos) {
        if (doc.documento_s3) await deleteFile(doc.documento_s3).catch(() => {});
      }
      documentosEliminados = publicacion.documentos.length;
    }

    // Eliminar notificaciones
    const notificacionesEliminadas = await Notificacion.eliminarNotificacionesPublicacion(id);

    // Eliminar publicación (CASCADE elimina documentos de la BD)
    const eliminado = await Publicacion.eliminar(id, req.usuario.id);

    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar la publicación', 400);
    }

    // 🆕 Emitir evento de eliminación
    if (global.io) {
      global.io.emit('delete_post', { id: Number(id) });
    }

    return successResponse(
      res, 
      { 
        deleted: true,
        notificacionesEliminadas,
        imagenEliminada: !!publicacion.imagen_s3,
        documentosEliminados
      }, 
      'Publicación eliminada correctamente'
    );

  } catch (error) {
    return errorResponse(res, 'Error al eliminar publicación', 500);
  }
};

/**
 * BUSCAR PUBLICACIONES
 * GET /api/publicaciones/buscar?q=termino
 */
exports.buscar = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return errorResponse(res, 'El término de búsqueda es obligatorio', 400);
    }

    const usuarioActualId = req.usuario?.id || null;
    const publicaciones = await Publicacion.buscar(q, usuarioActualId);

    return successResponse(res, publicaciones, `Resultados de búsqueda para: ${q}`);
  } catch (error) {
    console.error('Error en buscar publicaciones:', error);
    return errorResponse(res, 'Error al buscar publicaciones', 500);
  }
};