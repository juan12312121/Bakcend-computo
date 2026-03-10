const Documento = require('../models/Documento');
const fs = require('fs').promises;
const path = require('path');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * ELIMINAR ARCHIVO DEL SISTEMA LOCAL
 */
const deleteLocalFile = async (filePath) => {
  try {
    if (filePath && filePath.startsWith('/uploads/')) {
      const fullPath = path.join(__dirname, '..', filePath);
      await fs.unlink(fullPath);
      console.log(`🗑️ Archivo eliminado: ${fullPath}`);
    }
  } catch (error) {
    console.error('Error al eliminar archivo:', error);
  }
};

/**
 * SUBIR DOCUMENTO
 * POST /api/documentos
 */
exports.subirDocumento = async (req, res) => {
  try {
    const { nombre_archivo_custom, publicacion_id } = req.body;

    if (!req.file) {
      return errorResponse(res, 'No se seleccionó archivo', 400);
    }

    const tiposPermitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/x-rar-compressed',
      'application/x-zip-compressed',
      'text/csv',
      'text/plain'
    ];

    if (!tiposPermitidos.includes(req.file.mimetype)) {
      // Eliminar archivo del sistema local
      await deleteLocalFile(req.file.path);
      return errorResponse(res, 'Tipo de archivo no permitido. Solo: PDF, Word, Excel, PowerPoint, ZIP, CSV, TXT', 400);
    }

    // Generar URL relativa para acceso
    const documento_url = `/uploads/documentos/${req.file.filename}`;

    const { icono, color } = Documento.obtenerIconoYColor(req.file.mimetype);

    const documentoId = await Documento.crear({
      usuario_id: req.usuario.id,
      publicacion_id: publicacion_id || null,
      documento_url: documento_url,
      documento_s3: '', // 🔥 String vacío en lugar de null
      nombre_archivo: nombre_archivo_custom || req.file.originalname,
      tamano_archivo: req.file.size,
      tipo_archivo: req.file.mimetype,
      icono,
      color
    });

    const documento = await Documento.obtenerPorId(documentoId);

    return successResponse(res, documento, 'Documento subido correctamente', 201);
  } catch (error) {
    console.error('Error al subir documento:', error);
    // Eliminar archivo si hubo error
    if (req.file) {
      await deleteLocalFile(req.file.path);
    }
    return errorResponse(res, 'Error al subir el documento', 500);
  }
};

/**
 * OBTENER DOCUMENTOS DE UN USUARIO
 * GET /api/documentos/usuario/:usuario_id
 */
exports.obtenerDocumentosUsuario = async (req, res) => {
  try {
    const { usuario_id } = req.params;
    const documentos = await Documento.obtenerPorUsuario(usuario_id);

    return successResponse(
      res,
      documentos,
      documentos.length > 0 
        ? `${documentos.length} documento(s) del usuario` 
        : 'El usuario no tiene documentos'
    );
  } catch (error) {
    console.error('Error al obtener documentos del usuario:', error);
    return errorResponse(res, 'Error al obtener documentos del usuario', 500);
  }
};

/**
 * OBTENER MIS DOCUMENTOS
 * GET /api/documentos/mis-documentos
 */
exports.obtenerMisDocumentos = async (req, res) => {
  try {
    const documentos = await Documento.obtenerPorUsuario(req.usuario.id);

    return successResponse(
      res,
      documentos,
      documentos.length > 0 ? 'Mis documentos' : 'No tienes documentos'
    );
  } catch (error) {
    console.error('Error al obtener mis documentos:', error);
    return errorResponse(res, 'Error al obtener los documentos', 500);
  }
};

/**
 * OBTENER DOCUMENTO POR ID
 * GET /api/documentos/:id
 */
exports.obtenerDocumento = async (req, res) => {
  try {
    const { id } = req.params;
    const documento = await Documento.obtenerPorId(id);

    if (!documento) {
      return errorResponse(res, 'Documento no encontrado', 404);
    }

    return successResponse(res, documento, 'Documento encontrado');
  } catch (error) {
    console.error('Error al obtener documento:', error);
    return errorResponse(res, 'Error al obtener el documento', 500);
  }
};

/**
 * OBTENER DOCUMENTOS DE UNA PUBLICACIÓN
 * GET /api/documentos/publicacion/:publicacion_id
 */
exports.obtenerDocumentosPorPublicacion = async (req, res) => {
  try {
    const { publicacion_id } = req.params;
    const documentos = await Documento.obtenerPorPublicacion(publicacion_id);

    return successResponse(
      res,
      documentos,
      `${documentos.length} documento(s) encontrado(s)`
    );
  } catch (error) {
    console.error('Error al obtener documentos de publicación:', error);
    return errorResponse(res, 'Error al obtener documentos de la publicación', 500);
  }
};

/**
 * ACTUALIZAR DOCUMENTO
 * PUT /api/documentos/:id
 */
exports.actualizarDocumento = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_archivo_custom, icono, color, publicacion_id } = req.body;

    const documento = await Documento.obtenerPorId(id);
    if (!documento || documento.usuario_id !== req.usuario.id) {
      if (req.file) {
        await deleteLocalFile(req.file.path);
      }
      return errorResponse(res, 'Documento no encontrado o no autorizado', 404);
    }

    let datosActualizar = {};
    
    if (req.file) {
      // Eliminar archivo anterior
      if (documento.documento_url) {
        await deleteLocalFile(documento.documento_url);
      }

      // Nuevo archivo
      datosActualizar.documento_url = `/uploads/documentos/${req.file.filename}`;
      datosActualizar.nombre_archivo = nombre_archivo_custom || req.file.originalname;
      datosActualizar.tamano_archivo = req.file.size;
      datosActualizar.tipo_archivo = req.file.mimetype;

      const { icono: nuevoIcono, color: nuevoColor } = Documento.obtenerIconoYColor(req.file.mimetype);
      datosActualizar.icono = nuevoIcono;
      datosActualizar.color = nuevoColor;
    } else {
      // Solo actualizar metadatos
      if (nombre_archivo_custom) datosActualizar.nombre_archivo = nombre_archivo_custom;
      if (icono) datosActualizar.icono = icono;
      if (color) datosActualizar.color = color;
      if (publicacion_id !== undefined) datosActualizar.publicacion_id = publicacion_id;
    }

    const actualizado = await Documento.actualizar(id, req.usuario.id, datosActualizar);

    if (!actualizado) {
      if (req.file) {
        await deleteLocalFile(req.file.path);
      }
      return errorResponse(res, 'No se pudo actualizar el documento', 400);
    }

    const documentoActualizado = await Documento.obtenerPorId(id);

    return successResponse(res, documentoActualizado, 'Documento actualizado correctamente');
  } catch (error) {
    console.error('Error al actualizar documento:', error);
    if (req.file) {
      await deleteLocalFile(req.file.path);
    }
    return errorResponse(res, 'Error al actualizar el documento', 500);
  }
};

/**
 * VINCULAR DOCUMENTO A PUBLICACIÓN
 * PATCH /api/documentos/:id/vincular
 */
exports.vincularDocumentoAPublicacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { publicacion_id } = req.body;

    if (!publicacion_id) {
      return errorResponse(res, 'El ID de publicación es requerido', 400);
    }

    const documento = await Documento.obtenerPorId(id);
    if (!documento || documento.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'Documento no encontrado o no autorizado', 404);
    }

    const actualizado = await Documento.actualizar(id, req.usuario.id, {
      publicacion_id
    });

    if (!actualizado) {
      return errorResponse(res, 'No se pudo vincular el documento', 400);
    }

    const documentoActualizado = await Documento.obtenerPorId(id);

    return successResponse(res, documentoActualizado, 'Documento vinculado a publicación');
  } catch (error) {
    console.error('Error al vincular documento:', error);
    return errorResponse(res, 'Error al vincular documento', 500);
  }
};

/**
 * DESVINCULAR DOCUMENTO DE PUBLICACIÓN
 * PATCH /api/documentos/:id/desvincular
 */
exports.desvincularDocumento = async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await Documento.obtenerPorId(id);
    if (!documento || documento.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'Documento no encontrado o no autorizado', 404);
    }

    const desvinculado = await Documento.desvincularDePublicacion(id, req.usuario.id);

    if (!desvinculado) {
      return errorResponse(res, 'No se pudo desvincular el documento', 400);
    }

    const documentoActualizado = await Documento.obtenerPorId(id);

    return successResponse(res, documentoActualizado, 'Documento desvinculado de publicación');
  } catch (error) {
    console.error('Error al desvincular documento:', error);
    return errorResponse(res, 'Error al desvincular documento', 500);
  }
};

/**
 * ELIMINAR DOCUMENTO
 * DELETE /api/documentos/:id
 */
exports.eliminarDocumento = async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await Documento.obtenerPorId(id);
    if (!documento || documento.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'Documento no encontrado o no autorizado', 404);
    }

    // Eliminar archivo del sistema
    if (documento.documento_url) {
      await deleteLocalFile(documento.documento_url);
    }

    const eliminado = await Documento.eliminar(id, req.usuario.id);

    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar el documento', 400);
    }

    return successResponse(res, { deleted: true }, 'Documento eliminado correctamente');
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    return errorResponse(res, 'Error al eliminar el documento', 500);
  }
};

/**
 * OBTENER TODOS LOS DOCUMENTOS (ADMIN)
 * GET /api/documentos
 */
exports.obtenerTodosDocumentos = async (req, res) => {
  try {
    const documentos = await Documento.obtenerTodos();

    return successResponse(res, documentos, 'Lista de documentos');
  } catch (error) {
    console.error('Error al obtener todos los documentos:', error);
    return errorResponse(res, 'Error al obtener los documentos', 500);
  }
};