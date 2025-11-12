const Documento = require('../models/Documento');
const { deleteFromS3 } = require('../config/aws');
const { successResponse, errorResponse } = require('../utils/responses');

exports.subirDocumento = async (req, res) => {
  try {
    const { nombre_archivo_custom } = req.body;

    if (!req.file) {
      return errorResponse(res, 'No se seleccionó archivo', 400);
    }

    // Validar tipos de archivo permitidos
    const tiposPermitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];

    if (!tiposPermitidos.includes(req.file.mimetype)) {
      return errorResponse(res, 'Tipo de archivo no permitido. Solo: PDF, Word, Excel, PowerPoint', 400);
    }

    // Obtener icono y color según tipo de archivo
    const { icono, color } = Documento.obtenerIconoYColor(req.file.mimetype);

    // Crear registro en base de datos
    const documentoId = await Documento.crear({
      usuario_id: req.usuario.id,
      documento_url: null,
      documento_s3: req.file.location,
      nombre_archivo: nombre_archivo_custom || req.file.originalname,
      tamano_archivo: req.file.size,
      tipo_archivo: req.file.mimetype,
      icono,
      color
    });

    const documento = await Documento.obtenerPorId(documentoId);

    console.log(`📄 Usuario ${req.usuario.id} subió documento: ${documentoId}`);
    console.log(`📤 Ubicación S3: ${req.file.location}`);

    return successResponse(res, documento, 'Documento subido correctamente', 201);
  } catch (error) {
    console.error('❌ Error al subir documento:', error);
    return errorResponse(res, 'Error al subir el documento', 500);
  }
};

exports.obtenerMisDocumentos = async (req, res) => {
  try {
    const documentos = await Documento.obtenerPorUsuario(req.usuario.id);

    return successResponse(
      res,
      documentos,
      documentos.length > 0 ? 'Mis documentos' : 'No tienes documentos'
    );
  } catch (error) {
    console.error('❌ Error al obtener documentos:', error);
    return errorResponse(res, 'Error al obtener los documentos', 500);
  }
};

exports.obtenerDocumento = async (req, res) => {
  try {
    const { id } = req.params;
    const documento = await Documento.obtenerPorId(id);

    if (!documento) {
      return errorResponse(res, 'Documento no encontrado', 404);
    }

    return successResponse(res, documento, 'Documento encontrado');
  } catch (error) {
    console.error('❌ Error al obtener documento:', error);
    return errorResponse(res, 'Error al obtener el documento', 500);
  }
};

exports.actualizarDocumento = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_archivo_custom, icono, color } = req.body;

    // Verificar que el documento existe y pertenece al usuario
    const documento = await Documento.obtenerPorId(id);
    if (!documento || documento.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'Documento no encontrado o no autorizado', 404);
    }

    // Si hay nuevo archivo
    let datosActualizar = {};
    if (req.file) {
      // Eliminar archivo anterior de S3
      if (documento.documento_s3) {
        await deleteFromS3(documento.documento_s3);
      }

      datosActualizar.documento_s3 = req.file.location;
      datosActualizar.nombre_archivo = nombre_archivo_custom || req.file.originalname;

      const { icono: nuevoIcono, color: nuevoColor } = Documento.obtenerIconoYColor(req.file.mimetype);
      datosActualizar.icono = nuevoIcono;
      datosActualizar.color = nuevoColor;
    } else {
      // Solo actualizar nombre, icono o color
      if (nombre_archivo_custom) datosActualizar.nombre_archivo = nombre_archivo_custom;
      if (icono) datosActualizar.icono = icono;
      if (color) datosActualizar.color = color;
    }

    const actualizado = await Documento.actualizar(id, req.usuario.id, datosActualizar);

    if (!actualizado) {
      return errorResponse(res, 'No se pudo actualizar el documento', 400);
    }

    const documentoActualizado = await Documento.obtenerPorId(id);

    console.log(`✏️ Usuario ${req.usuario.id} actualizó documento ${id}`);

    return successResponse(res, documentoActualizado, 'Documento actualizado correctamente');
  } catch (error) {
    console.error('❌ Error al actualizar documento:', error);
    return errorResponse(res, 'Error al actualizar el documento', 500);
  }
};

exports.eliminarDocumento = async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await Documento.obtenerPorId(id);
    if (!documento || documento.usuario_id !== req.usuario.id) {
      return errorResponse(res, 'Documento no encontrado o no autorizado', 404);
    }

    // Eliminar de S3
    if (documento.documento_s3) {
      await deleteFromS3(documento.documento_s3);
    }

    const eliminado = await Documento.eliminar(id, req.usuario.id);

    if (!eliminado) {
      return errorResponse(res, 'No se pudo eliminar el documento', 400);
    }

    console.log(`🗑️ Usuario ${req.usuario.id} eliminó documento ${id}`);

    return successResponse(res, { deleted: true }, 'Documento eliminado correctamente');
  } catch (error) {
    console.error('❌ Error al eliminar documento:', error);
    return errorResponse(res, 'Error al eliminar el documento', 500);
  }
};

exports.obtenerTodosDocumentos = async (req, res) => {
  try {
    const documentos = await Documento.obtenerTodos();

    return successResponse(res, documentos, 'Lista de documentos');
  } catch (error) {
    console.error('❌ Error al obtener documentos:', error);
    return errorResponse(res, 'Error al obtener los documentos', 500);
  }
};

