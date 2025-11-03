const SeccionModel = require('../models/Seccion');
const PublicacionModel = require('../models/Publicacion');

const seccionesController = {
  
  // Crear una nueva sección
  crearSeccion: async (req, res) => {
    try {
      const { nombre, icono, color } = req.body;
      const usuario_id = req.user.id;

      // Validaciones
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

      // Verificar que no exista otra sección con el mismo nombre
      const seccionExistente = await SeccionModel.buscarPorNombreYUsuario(
        nombre.trim(), 
        usuario_id
      );

      if (seccionExistente) {
        return res.status(409).json({ 
          error: 'Ya existe una sección con ese nombre' 
        });
      }

      // Crear la sección
      const seccionId = await SeccionModel.crear(
        usuario_id,
        nombre.trim(),
        icono || 'fa-folder',
        color || 'from-gray-400 to-gray-600'
      );

      // Obtener la sección creada
      const seccion = await SeccionModel.buscarPorId(seccionId);

      res.status(201).json({
        mensaje: 'Sección creada exitosamente',
        seccion
      });

    } catch (error) {
      console.error('Error al crear sección:', error);
      res.status(500).json({ 
        error: 'Error al crear la sección' 
      });
    }
  },

  // Obtener todas las secciones del usuario autenticado
  obtenerMisSecciones: async (req, res) => {
    try {
      const usuario_id = req.user.id;

      const secciones = await SeccionModel.obtenerPorUsuario(usuario_id);

      res.json({
        secciones,
        total: secciones.length
      });

    } catch (error) {
      console.error('Error al obtener secciones:', error);
      res.status(500).json({ 
        error: 'Error al obtener las secciones' 
      });
    }
  },

  // Obtener una sección específica con sus posts
  obtenerSeccion: async (req, res) => {
    try {
      const { id } = req.params;
      const usuario_id = req.user.id;

      // Buscar la sección
      const seccion = await SeccionModel.buscarPorIdYUsuario(id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      // Obtener los posts de esta sección
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
      const usuario_id = req.user.id;

      // Verificar que la sección pertenece al usuario
      const seccion = await SeccionModel.buscarPorIdYUsuario(id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      // Validar nombre si se proporciona
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

        // Verificar duplicados (excluyendo la sección actual)
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

      // Preparar datos para actualizar
      const datosActualizar = {};
      if (nombre !== undefined) datosActualizar.nombre = nombre.trim();
      if (icono !== undefined) datosActualizar.icono = icono;
      if (color !== undefined) datosActualizar.color = color;

      if (Object.keys(datosActualizar).length === 0) {
        return res.status(400).json({ 
          error: 'No hay datos para actualizar' 
        });
      }

      // Actualizar
      await SeccionModel.actualizar(id, datosActualizar);

      // Obtener la sección actualizada
      const seccionActualizada = await SeccionModel.buscarPorId(id);

      res.json({
        mensaje: 'Sección actualizada exitosamente',
        seccion: seccionActualizada
      });

    } catch (error) {
      console.error('Error al actualizar sección:', error);
      res.status(500).json({ 
        error: 'Error al actualizar la sección' 
      });
    }
  },

  // Eliminar una sección
  eliminarSeccion: async (req, res) => {
    try {
      const { id } = req.params;
      const usuario_id = req.user.id;

      // Verificar que la sección pertenece al usuario
      const seccion = await SeccionModel.buscarPorIdYUsuario(id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      // Eliminar la sección
      await SeccionModel.eliminar(id, usuario_id);

      res.json({
        mensaje: 'Sección eliminada exitosamente'
      });

    } catch (error) {
      console.error('Error al eliminar sección:', error);
      res.status(500).json({ 
        error: 'Error al eliminar la sección' 
      });
    }
  },

  // Agregar un post a una sección
  agregarPostASeccion: async (req, res) => {
    try {
      const { seccion_id, publicacion_id } = req.body;
      const usuario_id = req.user.id;

      // Validaciones
      if (!seccion_id || !publicacion_id) {
        return res.status(400).json({ 
          error: 'Se requiere seccion_id y publicacion_id' 
        });
      }

      // Verificar que la sección pertenece al usuario
      const seccion = await SeccionModel.buscarPorIdYUsuario(seccion_id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      // Verificar que el post pertenece al usuario
      const postExiste = await PublicacionModel.existeYPerteneceAUsuario(
        publicacion_id, 
        usuario_id
      );

      if (!postExiste) {
        return res.status(404).json({ 
          error: 'Publicación no encontrada' 
        });
      }

      // Verificar si ya existe la relación
      const relacionExiste = await SeccionModel.existeRelacionPostSeccion(
        seccion_id, 
        publicacion_id
      );

      if (relacionExiste) {
        return res.status(409).json({ 
          error: 'El post ya está en esta sección' 
        });
      }

      // Agregar el post a la sección
      await SeccionModel.agregarPost(seccion_id, publicacion_id);

      res.json({
        mensaje: 'Post agregado a la sección exitosamente'
      });

    } catch (error) {
      console.error('Error al agregar post a sección:', error);
      res.status(500).json({ 
        error: 'Error al agregar el post a la sección' 
      });
    }
  },

  // Quitar un post de una sección
  quitarPostDeSeccion: async (req, res) => {
    try {
      const { seccion_id, publicacion_id } = req.body;
      const usuario_id = req.user.id;

      // Validaciones
      if (!seccion_id || !publicacion_id) {
        return res.status(400).json({ 
          error: 'Se requiere seccion_id y publicacion_id' 
        });
      }

      // Verificar que la sección pertenece al usuario
      const seccion = await SeccionModel.buscarPorIdYUsuario(seccion_id, usuario_id);

      if (!seccion) {
        return res.status(404).json({ 
          error: 'Sección no encontrada' 
        });
      }

      // Quitar el post de la sección
      const exitoso = await SeccionModel.quitarPost(seccion_id, publicacion_id);

      if (!exitoso) {
        return res.status(404).json({ 
          error: 'El post no está en esta sección' 
        });
      }

      res.json({
        mensaje: 'Post removido de la sección exitosamente'
      });

    } catch (error) {
      console.error('Error al quitar post de sección:', error);
      res.status(500).json({ 
        error: 'Error al quitar el post de la sección' 
      });
    }
  },

  // Obtener las secciones de un post específico
  obtenerSeccionesDePost: async (req, res) => {
    try {
      const { publicacion_id } = req.params;
      const usuario_id = req.user.id;

      // Verificar que el post pertenece al usuario
      const postExiste = await PublicacionModel.existeYPerteneceAUsuario(
        publicacion_id, 
        usuario_id
      );

      if (!postExiste) {
        return res.status(404).json({ 
          error: 'Publicación no encontrada' 
        });
      }

      // Obtener las secciones del post
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