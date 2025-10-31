// controllers/seguidoresController.js
const Seguidor = require('../models/Seguidor');

class SeguidoresController {
  // Seguir a un usuario
  static async seguir(req, res) {
    try {
      const { seguidor_id, siguiendo_id } = req.body;

      if (!seguidor_id || !siguiendo_id) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros' });
      }

      const resultado = await Seguidor.seguir(seguidor_id, siguiendo_id);
      res.json(resultado);
    } catch (error) {
      console.error('Error al seguir:', error);
      res.status(500).json({ success: false, message: 'Error del servidor' });
    }
  }

  // Dejar de seguir
  static async dejarDeSeguir(req, res) {
    try {
      const { seguidor_id, siguiendo_id } = req.body;

      if (!seguidor_id || !siguiendo_id) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros' });
      }

      const resultado = await Seguidor.dejarDeSeguir(seguidor_id, siguiendo_id);
      res.json(resultado);
    } catch (error) {
      console.error('Error al dejar de seguir:', error);
      res.status(500).json({ success: false, message: 'Error del servidor' });
    }
  }

  // Toggle seguir/dejar
  static async toggle(req, res) {
    try {
      const { seguidor_id, siguiendo_id } = req.body;

      if (!seguidor_id || !siguiendo_id) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros' });
      }

      const resultado = await Seguidor.toggle(seguidor_id, siguiendo_id);
      res.json(resultado);
    } catch (error) {
      console.error('Error en toggle:', error);
      res.status(500).json({ success: false, message: 'Error del servidor' });
    }
  }

  // Verificar si sigue a otro
  static async verificar(req, res) {
    try {
      const { seguidor_id, siguiendo_id } = req.params;
      const sigue = await Seguidor.verificar(seguidor_id, siguiendo_id);
      res.json({ sigue });
    } catch (error) {
      console.error('Error al verificar:', error);
      res.status(500).json({ success: false, message: 'Error del servidor' });
    }
  }

  // Listar seguidores
  static async listarSeguidores(req, res) {
    try {
      const { id } = req.params;
      const seguidores = await Seguidor.obtenerSeguidores(id);
      res.json({ total: seguidores.length, seguidores });
    } catch (error) {
      console.error('Error al listar seguidores:', error);
      res.status(500).json({ success: false, message: 'Error del servidor' });
    }
  }

  // Listar seguidos
  static async listarSeguidos(req, res) {
    try {
      const { id } = req.params;
      const seguidos = await Seguidor.obtenerSeguidos(id);
      res.json({ total: seguidos.length, seguidos });
    } catch (error) {
      console.error('Error al listar seguidos:', error);
      res.status(500).json({ success: false, message: 'Error del servidor' });
    }
  }
}

module.exports = SeguidoresController;
