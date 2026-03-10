const Publicacion = require('../models/Publicacion');
const Documento = require('../models/Documento');
const Notificacion = require('../models/Notificacion');
const CensuraPublicaciones = require('../services/CensuraPublicaciones');
const { deleteLocalFile, getRelativeUrl } = require('../utils/fileUtils');
const { successResponse, errorResponse } = require('../utils/responses');
const { getIo } = require('../config/socket');

/**
 * OBTENER CATEGORÍAS DISPONIBLES
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
 * CREAR PUBLICACIÓN - CON IMAGEN, DOCUMENTOS Y VISIBILIDAD
 */
exports.crearPublicacion = async (req, res) => {
  let imagenSubida = false;
  let documentosSubidos = [];

  try {
    const { contenido, categoria, visibilidad } = req.body;

    console.log('📝 Creando publicación:', { contenido: contenido?.substring(0, 50), categoria, visibilidad });
    console.log('📎 Archivos recibidos:', {
      imagen: req.files?.imagen?.[0]?.filename,
      documentos: req.files?.documentos?.length || 0
    });

    // Validar contenido
    if (!contenido || contenido.trim().length === 0) {
      if (req.files?.imagen?.[0]) {
        await deleteLocalFile(req.files.imagen[0].path);
      }
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) {
          await deleteLocalFile(doc.path);
        }
      }
      return errorResponse(res, 'El contenido es obligatorio', 400);
    }

    if (contenido.length > 5000) {
      if (req.files?.imagen?.[0]) {
        await deleteLocalFile(req.files.imagen[0].path);
      }
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) {
          await deleteLocalFile(doc.path);
        }
      }
      return errorResponse(res, 'La publicación no puede exceder 5000 caracteres', 400);
    }

    // Validar categoría
    const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
    if (categoria && !categoriasValidas.includes(categoria)) {
      if (req.files?.imagen?.[0]) {
        await deleteLocalFile(req.files.imagen[0].path);
      }
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) {
          await deleteLocalFile(doc.path);
        }
      }
      return errorResponse(
        res,
        `Categoría inválida. Debe ser una de: ${categoriasValidas.join(', ')}`,
        400
      );
    }

    // Validar visibilidad
    const visibilidadesValidas = ['publico', 'privado', 'seguidores'];
    const visibilidadFinal = visibilidad || 'publico';

    if (!visibilidadesValidas.includes(visibilidadFinal)) {
      if (req.files?.imagen?.[0]) {
        await deleteLocalFile(req.files.imagen[0].path);
      }
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) {
          await deleteLocalFile(doc.path);
        }
      }
      return errorResponse(
        res,
        `Visibilidad inválida. Debe ser: ${visibilidadesValidas.join(', ')}`,
        400
      );
    }

    // 🔍 ANÁLISIS DE CENSURA - CONTENIDO
    const analisisContenido = await CensuraPublicaciones.validarContenido(
      contenido,
      categoria || 'General'
    );

    if (!analisisContenido.valido || analisisContenido.accion === 'rechazar') {
      if (req.files?.imagen?.[0]) {
        await deleteLocalFile(req.files.imagen[0].path);
      }
      if (req.files?.documentos) {
        for (const doc of req.files.documentos) {
          await deleteLocalFile(doc.path);
        }
      }

      return errorResponse(
        res,
        `Tu publicación fue rechazada: ${analisisContenido.razon}`,
        403,
        {
          motivo: analisisContenido.razon,
          confianza: analisisContenido.confianza,
          detalles: {
            contenido: analisisContenido.problemas,
            imagen: []
          }
        }
      );
    }

    if (req.files?.imagen?.[0]) {
      imagenSubida = true;
    }

    // 🔍 ANÁLISIS DE CENSURA - IMAGEN
    let analisisImagen = null;
    if (req.files?.imagen?.[0]) {
      // Usar la ruta completa del archivo
      analisisImagen = await CensuraPublicaciones.validarImagenDescripcion(
        req.files.imagen[0].path,
        contenido
      );

      if (!analisisImagen.apropiada || analisisImagen.accion === 'rechazar') {
        await deleteLocalFile(req.files.imagen[0].path);

        if (req.files?.documentos) {
          for (const doc of req.files.documentos) {
            await deleteLocalFile(doc.path);
          }
        }

        return errorResponse(
          res,
          `Tu imagen fue rechazada: ${analisisImagen.razon}`,
          403,
          {
            motivo: analisisImagen.razon,
            confianza: analisisImagen.confianza,
            detalles: {
              contenido: [],
              imagen: analisisImagen.problemas
            }
          }
        );
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

    // Generar URL accesible para la imagen
    let imagenUrl = getRelativeUrl(req.files?.imagen?.[0]?.path);
    console.log('📸 Imagen URL generada:', imagenUrl);

    // 📝 CREAR PUBLICACIÓN EN BD
    const nuevaPublicacionId = await Publicacion.crear({
      usuario_id: req.usuario.id,
      contenido,
      imagen_url: imagenUrl,
      imagen_s3: null, // No usamos S3
      categoria: categoria || 'General',
      visibilidad: visibilidadFinal,
      requiere_revision: requiereRevision ? 1 : 0,
      analisis_censura: JSON.stringify(reporte),
      grupo_id: req.body.grupo_id || null
    });

    console.log('✅ Publicación creada con ID:', nuevaPublicacionId);

    // 🆕 GUARDAR DOCUMENTOS EN BD
    if (req.files?.documentos && req.files.documentos.length > 0) {
      for (const doc of req.files.documentos) {
        try {
          const { icono, color } = Documento.obtenerIconoYColor(doc.mimetype);

          // Generar URL accesible para el documento
          const documentoUrl = getRelativeUrl(doc.path);

          const documentoId = await Documento.crear({
            usuario_id: req.usuario.id,
            publicacion_id: nuevaPublicacionId,
            documento_url: documentoUrl,
            documento_s3: null, // No usamos S3
            nombre_archivo: doc.originalname,
            tamano_archivo: doc.size,
            tipo_archivo: doc.mimetype,
            icono,
            color
          });

          documentosSubidos.push({
            id: documentoId,
            url: documentoUrl,
            nombre: doc.originalname
          });

          console.log(`✅ Documento ${documentoId} vinculado a publicación ${nuevaPublicacionId}`);
        } catch (docError) {
          console.error('❌ Error al guardar documento:', docError);
        }
      }
    }

    // Obtener publicación completa con documentos
    const publicacion = await Publicacion.obtenerPorId(nuevaPublicacionId, req.usuario.id);

    // Emitir evento por Socket.io
    try {
      getIo().emit('new_post', publicacion);
      console.log('📡 Evento new_post emitido');
    } catch (socketError) {
      console.error('❌ Error al emitir evento Socket.io:', socketError);
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

    // Limpiar archivos en caso de error
    if (req.files?.imagen?.[0] && imagenSubida) {
      await deleteLocalFile(req.files.imagen[0].path);
    }

    if (req.files?.documentos) {
      for (const doc of req.files.documentos) {
        await deleteLocalFile(doc.path);
      }
    }

    return errorResponse(res, 'Error al crear publicación', 500);
  }
};

/**
 * OBTENER PUBLICACIONES (FEED)
 */
exports.obtenerPublicaciones = async (req, res) => {
  try {
    let publicaciones;

    if (!req.usuario || !req.usuario.id) {
      publicaciones = await Publicacion.obtenerAleatorias(20);
      return successResponse(res, publicaciones, 'Publicaciones públicas');
    }

    try {
      publicaciones = await Publicacion.obtenerTodasParaUsuario(req.usuario.id);

      if (!publicaciones || publicaciones.length === 0) {
        publicaciones = await Publicacion.obtenerAleatorias(20);
        return successResponse(res, publicaciones, 'Publicaciones aleatorias (no sigues a nadie)');
      }

      if (publicaciones.length < 5) {
        const aleatorias = await Publicacion.obtenerAleatorias(10);
        const idsExistentes = new Set(publicaciones.map(p => p.id));
        const nuevas = aleatorias.filter(p => !idsExistentes.has(p.id));
        publicaciones = [...publicaciones, ...nuevas];
      }

      return successResponse(res, publicaciones, 'Feed personalizado');

    } catch (feedError) {
      publicaciones = await Publicacion.obtenerTodas(req.usuario.id);

      if (!publicaciones || publicaciones.length === 0) {
        return successResponse(res, [], 'No hay publicaciones disponibles');
      }

      return successResponse(res, publicaciones, 'Todas las publicaciones');
    }

  } catch (error) {
    try {
      const publicacionesBackup = await Publicacion.obtenerTodas(req.usuario?.id);
      return successResponse(res, publicacionesBackup || [], 'Publicaciones (modo backup)');
    } catch (backupError) {
      return errorResponse(res, 'Error al obtener publicaciones', 500);
    }
  }
};

/**
 * OBTENER UNA PUBLICACIÓN POR ID
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
 * OBTENER PUBLICACIONES DE OTRO USUARIO
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
 * ACTUALIZAR PUBLICACIÓN
 */
exports.actualizarPublicacion = async (req, res) => {
  let imagenSubida = false;

  try {
    const { id } = req.params;
    const { contenido, categoria, visibilidad } = req.body;

    const publicacionActual = await Publicacion.obtenerPorId(id, req.usuario.id);
    if (!publicacionActual) {
      if (req.file) {
        await deleteLocalFile(req.file.path);
      }
      return errorResponse(res, 'Publicación no encontrada', 404);
    }

    if (publicacionActual.usuario_id !== req.usuario.id) {
      if (req.file) {
        await deleteLocalFile(req.file.path);
      }
      return errorResponse(res, 'No tienes permiso para actualizar esta publicación', 403);
    }

    if (contenido && contenido.length > 5000) {
      if (req.file) {
        await deleteLocalFile(req.file.path);
      }
      return errorResponse(res, 'La publicación no puede exceder 5000 caracteres', 400);
    }

    if (categoria) {
      const categoriasValidas = Publicacion.getCategorias().map(c => c.value);
      if (!categoriasValidas.includes(categoria)) {
        if (req.file) {
          await deleteLocalFile(req.file.path);
        }
        return errorResponse(res, `Categoría inválida`, 400);
      }
    }

    if (visibilidad) {
      const visibilidadesValidas = ['publico', 'privado', 'seguidores'];
      if (!visibilidadesValidas.includes(visibilidad)) {
        if (req.file) {
          await deleteLocalFile(req.file.path);
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
        if (req.file) {
          await deleteLocalFile(req.file.path);
        }
        return errorResponse(
          res,
          `Tu contenido actualizado es inapropiado: ${analisisContenido.razon}`,
          403,
          {
            problemas: analisisContenido.problemas,
            confianza: analisisContenido.confianza
          }
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
        await deleteLocalFile(req.file.path);

        return errorResponse(
          res,
          `Tu imagen actualizada es inapropiada: ${analisisImagen.razon}`,
          403,
          {
            problemas: analisisImagen.problemas,
            confianza: analisisImagen.confianza
          }
        );
      }
    }

    const datosActualizar = {};
    if (contenido) datosActualizar.contenido = contenido;
    if (categoria) datosActualizar.categoria = categoria;
    if (visibilidad) datosActualizar.visibilidad = visibilidad;

    if (req.file) {
      // Eliminar imagen anterior
      if (publicacionActual.imagen_url) {
        await deleteLocalFile(publicacionActual.imagen_url);
      }

      datosActualizar.imagen_url = getRelativeUrl(req.file.path);
      datosActualizar.imagen_s3 = null;
    }

    const actualizado = await Publicacion.actualizar(id, req.usuario.id, datosActualizar);

    if (!actualizado) {
      if (req.file && imagenSubida) {
        await deleteLocalFile(req.file.path);
      }
      return errorResponse(res, 'No se pudo actualizar la publicación', 400);
    }

    const publicacionActualizada = await Publicacion.obtenerPorId(id, req.usuario.id);

    return successResponse(res, publicacionActualizada, 'Publicación actualizada correctamente');

  } catch (error) {
    if (req.file && imagenSubida) {
      await deleteLocalFile(req.file.path);
    }

    return errorResponse(res, 'Error al actualizar publicación', 500);
  }
};

/**
 * OBTENER DOCUMENTOS DE USUARIO
 */
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
 * ELIMINAR PUBLICACIÓN
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

    // Eliminar imagen local
    if (publicacion.imagen_url) {
      await deleteLocalFile(publicacion.imagen_url);
    }

    // Eliminar documentos asociados
    let documentosEliminados = 0;
    if (publicacion.documentos && publicacion.documentos.length > 0) {
      for (const doc of publicacion.documentos) {
        if (doc.documento_url) {
          await deleteLocalFile(doc.documento_url);
        }
      }
      documentosEliminados = publicacion.documentos.length;
    }

    // Eliminar notificaciones
    const notificacionesEliminadas = await Notificacion.eliminarNotificacionesPublicacion(id);

    // Eliminar publicación de BD
    const eliminado = await Publicacion.eliminar(id, req.usuario.id);

    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar la publicación', 400);
    }

    return successResponse(
      res,
      {
        deleted: true,
        notificacionesEliminadas,
        imagenEliminada: !!publicacion.imagen_url,
        documentosEliminados
      },
      'Publicación eliminada correctamente'
    );

  } catch (error) {
    return errorResponse(res, 'Error al eliminar publicación', 500);
  }
};