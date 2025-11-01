const Comentario = require('../models/Comentario');

const comentarioController = {
  // Crear un nuevo comentario
  async crear(req, res) {
    try {
      const { publicacion_id, texto } = req.body;
      const usuario_id = req.usuario.id; // Asumiendo que tienes middleware de autenticación

      // Validaciones
      if (!publicacion_id || !texto) {
        return res.status(400).json({
          success: false,
          message: 'El ID de publicación y el texto son requeridos'
        });
      }

      if (texto.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'El comentario no puede estar vacío'
        });
      }

      if (texto.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'El comentario no puede exceder 1000 caracteres'
        });
      }

      const comentarioId = await Comentario.crear(publicacion_id, usuario_id, texto);
      const comentario = await Comentario.obtenerPorId(comentarioId);

      res.status(201).json({
        success: true,
        message: 'Comentario creado exitosamente',
        data: comentario
      });
    } catch (error) {
      console.error('Error al crear comentario:', error);
      res.status(500).json({
        success: false,
        message: 'Error al crear el comentario',
        error: error.message
      });
    }
  },

  // Obtener comentarios de una publicación
  async obtenerPorPublicacion(req, res) {
    try {
      const { publicacion_id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const comentarios = await Comentario.obtenerPorPublicacion(publicacion_id, limit, offset);
      const total = await Comentario.contarPorPublicacion(publicacion_id);

      res.json({
        success: true,
        data: comentarios,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      });
    } catch (error) {
      console.error('Error al obtener comentarios:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener los comentarios',
        error: error.message
      });
    }
  },

  // Obtener comentarios de un usuario
  async obtenerPorUsuario(req, res) {
    try {
      const { usuario_id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const comentarios = await Comentario.obtenerPorUsuario(usuario_id, limit, offset);

      res.json({
        success: true,
        data: comentarios,
        pagination: {
          limit,
          offset
        }
      });
    } catch (error) {
      console.error('Error al obtener comentarios del usuario:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener los comentarios del usuario',
        error: error.message
      });
    }
  },

  // Obtener un comentario por ID
  async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      const comentario = await Comentario.obtenerPorId(id);

      if (!comentario) {
        return res.status(404).json({
          success: false,
          message: 'Comentario no encontrado'
        });
      }

      res.json({
        success: true,
        data: comentario
      });
    } catch (error) {
      console.error('Error al obtener comentario:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener el comentario',
        error: error.message
      });
    }
  },

  // Actualizar un comentario
  async actualizar(req, res) {
    try {
      const { id } = req.params;
      const { texto } = req.body;
      const usuario_id = req.usuario.id;

      // Validaciones
      if (!texto) {
        return res.status(400).json({
          success: false,
          message: 'El texto es requerido'
        });
      }

      if (texto.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'El comentario no puede estar vacío'
        });
      }

      if (texto.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'El comentario no puede exceder 1000 caracteres'
        });
      }

      // Verificar que el usuario sea dueño del comentario
      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permiso para editar este comentario'
        });
      }

      const actualizado = await Comentario.actualizar(id, texto);

      if (!actualizado) {
        return res.status(404).json({
          success: false,
          message: 'Comentario no encontrado'
        });
      }

      const comentario = await Comentario.obtenerPorId(id);

      res.json({
        success: true,
        message: 'Comentario actualizado exitosamente',
        data: comentario
      });
    } catch (error) {
      console.error('Error al actualizar comentario:', error);
      res.status(500).json({
        success: false,
        message: 'Error al actualizar el comentario',
        error: error.message
      });
    }
  },

  // Eliminar un comentario
  async eliminar(req, res) {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      // Verificar que el usuario sea dueño del comentario
      const esDelUsuario = await Comentario.esDelUsuario(id, usuario_id);

      if (!esDelUsuario) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permiso para eliminar este comentario'
        });
      }

      const eliminado = await Comentario.eliminar(id);

      if (!eliminado) {
        return res.status(404).json({
          success: false,
          message: 'Comentario no encontrado'
        });
      }

      res.json({
        success: true,
        message: 'Comentario eliminado exitosamente'
      });
    } catch (error) {
      console.error('Error al eliminar comentario:', error);
      res.status(500).json({
        success: false,
        message: 'Error al eliminar el comentario',
        error: error.message
      });
    }
  }
};

module.exports = comentarioController;