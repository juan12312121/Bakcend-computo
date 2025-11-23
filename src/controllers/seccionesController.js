// controllers/seccionesController.js - MÉTODOS PÚBLICOS AGREGADOS

const SeccionModel = require('../models/Seccion');
const PublicacionModel = require('../models/Publicacion');

const seccionesController = {
  
  // ==================== MÉTODOS PÚBLICOS (NUEVOS) ====================
  
  /**
   * Obtener las secciones públicas de un usuario específico
   * Cualquier persona puede ver las secciones de otro usuario
   */
  obtenerSeccionesDeUsuario: async (req, res) => {
    try {
      const { usuario_id } = req.params;

      if (!usuario_id || isNaN(usuario_id)) {
        return res.status(400).json({ 
          error: 'ID de usuario inválido' 
        });
      }

      // Obtener las secciones del usuario objetivo
      const secciones = await SeccionModel.obtenerPorUsuario(parseInt(usuario_id));

      // Retornar las secciones (solo lectura para otros usuarios)
      res.json({
        usuario_id: parseInt(usuario_id),
        secciones,
        total: secciones.length,
        es_propietario: false // Siempre false en esta ruta pública
      });

    } catch (error) {
      console.error('Error al obtener secciones del usuario:', error);
      res.status(500).json({ 
        error: 'Error al obtener las secciones del usuario' 
      });
    }
  },

  /**
   * Obtener una sección pública específica con sus posts
   * Cualquier persona puede ver el contenido de una sección
   */
  obtenerSeccionPublica: async (req, res) => {
    try {
      const { usuario_id, seccion_id } = req.params;

      if (!usuario_id || isNaN(usuario_id) || !seccion_id || isNaN(seccion_id)) {
        return res.status(400).json({ 
          error: 'IDs inválidos' 
        });
      }

      // Buscar la sección y verificar que pertenece al usuario especificado
      const seccion = await SeccionModel.buscarPorIdYUsuario(
        parseInt(seccion_id), 
        parseInt(usuario_id)
      );

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      // Obtener los posts públicos de esta sección
      const posts = await SeccionModel.obtenerPostsDeSeccion(
        parseInt(seccion_id), 
        parseInt(usuario_id)
      );

      res.json({
        seccion,
        posts,
        es_propietario: false // Siempre false en esta ruta pública
      });

    } catch (error) {
      console.error('Error al obtener sección pública:', error);
      res.status(500).json({ 
        error: 'Error al obtener la sección' 
      });
    }
  },

  // ==================== MÉTODOS PRIVADOS (YA EXISTENTES) ====================
  
  // Crear una nueva sección
  crearSeccion: async (req, res) => {
    try {
      const { nombre, icono, color } = req.body;
      const usuario_id = req.usuario.id;

      if (!nombre || nombre.trim().length === 0) {
        return res.status(400).json({ 
          error: 'El nombre de la sección es requerido' 
        });
      }

      if (nombre.length > 100) {
        return res.status(400).json({ 
          error: 'El nombre no puede exceder 100 caracteres' 
        });
      }

      const seccionExistente = await SeccionModel.buscarPorNombreYUsuario(
        nombre.trim(), 
        usuario_id
      );

      if (seccionExistente) {
        return res.status(409).json({ 
          error: 'Ya existe una sección con ese nombre' 
        });
      }

      const seccionId = await SeccionModel.crear(
        usuario_id,
        nombre.trim(),
        icono || 'fa-folder',
        color || 'from-gray-400 to-gray-600'
      );

      const seccion = await SeccionModel.buscarPorId(seccionId);

      res.status(201).json({
        success: true,
        mensaje: 'Sección creada exitosamente',
        seccion_id: seccionId,
        seccion
      });

    } catch (error) {
      console.error('Error al crear sección:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error al crear la sección' 
      });
    }
  },

  // Obtener todas las secciones del usuario autenticado
  obtenerMisSecciones: async (req, res) => {
    try {
      const usuario_id = req.usuario.id;
      const secciones = await SeccionModel.obtenerPorUsuario(usuario_id);
      
      res.json(secciones);

    } catch (error) {
      console.error('Error al obtener secciones:', error);
      res.status(500).json({ 
        error: 'Error al obtener las secciones' 
      });
    }
  },

  // Obtener una sección específica con sus posts (privado)
  obtenerSeccion: async (req, res) => {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      const seccion = await SeccionModel.buscarPorIdYUsuario(id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      const posts = await SeccionModel.obtenerPostsDeSeccion(id, usuario_id);

      res.json({
        seccion,
        posts
      });

    } catch (error) {
      console.error('Error al obtener sección:', error);
      res.status(500).json({ 
        error: 'Error al obtener la sección' 
      });
    }
  },

  // Actualizar una sección
  actualizarSeccion: async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, icono, color } = req.body;
      const usuario_id = req.usuario.id;

      const seccion = await SeccionModel.buscarPorIdYUsuario(id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      if (nombre !== undefined) {
        if (!nombre || nombre.trim().length === 0) {
          return res.status(400).json({ 
            error: 'El nombre no puede estar vacío' 
          });
        }

        if (nombre.length > 100) {
          return res.status(400).json({ 
            error: 'El nombre no puede exceder 100 caracteres' 
          });
        }

        const nombreDuplicado = await SeccionModel.buscarPorNombreExcluyendoId(
          nombre.trim(),
          usuario_id,
          id
        );

        if (nombreDuplicado) {
          return res.status(409).json({ 
            error: 'Ya existe una sección con ese nombre' 
          });
        }
      }

      const datosActualizar = {};
      if (nombre !== undefined) datosActualizar.nombre = nombre.trim();
      if (icono !== undefined) datosActualizar.icono = icono;
      if (color !== undefined) datosActualizar.color = color;

      if (Object.keys(datosActualizar).length === 0) {
        return res.status(400).json({ 
          error: 'No hay datos para actualizar' 
        });
      }

      await SeccionModel.actualizar(id, datosActualizar);
      const seccionActualizada = await SeccionModel.buscarPorId(id);

      res.json({
        success: true,
        mensaje: 'Sección actualizada exitosamente',
        seccion: seccionActualizada
      });

    } catch (error) {
      console.error('Error al actualizar sección:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error al actualizar la sección' 
      });
    }
  },

  // Eliminar una sección
  eliminarSeccion: async (req, res) => {
    try {
      const { id } = req.params;
      const usuario_id = req.usuario.id;

      const seccion = await SeccionModel.buscarPorIdYUsuario(id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      await SeccionModel.eliminar(id, usuario_id);

      res.json({
        success: true,
        mensaje: 'Sección eliminada exitosamente'
      });

    } catch (error) {
      console.error('Error al eliminar sección:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error al eliminar la sección' 
      });
    }
  },

  // Agregar un post a una sección
  agregarPostASeccion: async (req, res) => {
    try {
      const { seccion_id, publicacion_id } = req.body;
      const usuario_id = req.usuario.id;

      if (!seccion_id || !publicacion_id) {
        return res.status(400).json({ 
          error: 'Se requiere seccion_id y publicacion_id' 
        });
      }

      const seccion = await SeccionModel.buscarPorIdYUsuario(seccion_id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      const postExiste = await PublicacionModel.existeYPerteneceAUsuario(
        publicacion_id, 
        usuario_id
      );

      if (!postExiste) {
        return res.status(404).json({ 
          error: 'Publicación no encontrada' 
        });
      }

      const relacionExiste = await SeccionModel.existeRelacionPostSeccion(
        seccion_id, 
        publicacion_id
      );

      if (relacionExiste) {
        return res.status(409).json({ 
          error: 'El post ya está en esta sección' 
        });
      }

      await SeccionModel.agregarPost(seccion_id, publicacion_id);

      res.json({
        success: true,
        mensaje: 'Post agregado a la sección exitosamente'
      });

    } catch (error) {
      console.error('Error al agregar post a sección:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error al agregar el post a la sección' 
      });
    }
  },

  // Quitar un post de una sección
  quitarPostDeSeccion: async (req, res) => {
    try {
      const { seccion_id, publicacion_id } = req.body;
      const usuario_id = req.usuario.id;

      if (!seccion_id || !publicacion_id) {
        return res.status(400).json({ 
          error: 'Se requiere seccion_id y publicacion_id' 
        });
      }

      const seccion = await SeccionModel.buscarPorIdYUsuario(seccion_id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      const exitoso = await SeccionModel.quitarPost(seccion_id, publicacion_id);

      if (!exitoso) {
        return res.status(404).json({ 
          error: 'El post no está en esta sección' 
        });
      }

      res.json({
        success: true,
        mensaje: 'Post removido de la sección exitosamente'
      });

    } catch (error) {
      console.error('Error al quitar post de sección:', error);
      res.status(500).json({ 
        success: false,
        error: 'Error al quitar el post de la sección' 
      });
    }
  },

  // Obtener las secciones de un post específico
  obtenerSeccionesDePost: async (req, res) => {
    try {
      const { publicacion_id } = req.params;
      const usuario_id = req.usuario.id;

      const postExiste = await PublicacionModel.existeYPerteneceAUsuario(
        publicacion_id, 
        usuario_id
      );

      if (!postExiste) {
        return res.status(404).json({ 
          error: 'Publicación no encontrada' 
        });
      }

      const secciones = await SeccionModel.obtenerSeccionesDePost(publicacion_id);

      res.json({
        publicacion_id: parseInt(publicacion_id),
        secciones,
        total: secciones.length
      });

    } catch (error) {
      console.error('Error al obtener secciones del post:', error);
      res.status(500).json({ 
        error: 'Error al obtener las secciones del post' 
      });
    }
  }

};

module.exports = seccionesController;