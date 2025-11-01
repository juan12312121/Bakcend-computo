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
      const { seguidor_id, siguiendo_id } = req.params;
      
      console.log('📥 Toggle - Parámetros recibidos:', { seguidor_id, siguiendo_id });

      if (!seguidor_id || !siguiendo_id) {
        return res.status(400).json({ 
          success: false, 
          message: 'Faltan parámetros: seguidor_id y siguiendo_id son requeridos' 
        });
      }

      const seguidorId = parseInt(seguidor_id);
      const siguiendoId = parseInt(siguiendo_id);

      if (isNaN(seguidorId) || isNaN(siguiendoId)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Los IDs deben ser números válidos' 
        });
      }

      if (seguidorId === siguiendoId) {
        return res.status(400).json({ 
          success: false, 
          message: 'No puedes seguirte a ti mismo' 
        });
      }

      const resultado = await Seguidor.toggle(seguidorId, siguiendoId);
      
      console.log('✅ Resultado toggle:', resultado);
      
      res.json({ 
        success: true, 
        ...resultado 
      });
      
    } catch (error) {
      console.error('❌ Error en toggle:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error del servidor',
        error: error.message 
      });
    }
  }

  // Verificar si sigue a otro
  static async verificar(req, res) {
    try {
      const { seguidor_id, siguiendo_id } = req.params;
      
      console.log('📥 Verificar - Parámetros recibidos:', { seguidor_id, siguiendo_id });
      
      if (!seguidor_id || !siguiendo_id) {
        return res.status(400).json({ 
          success: false, 
          message: 'Faltan parámetros' 
        });
      }
      
      const sigue = await Seguidor.verificar(
        parseInt(seguidor_id), 
        parseInt(siguiendo_id)
      );
      
      console.log('✅ Resultado verificar:', sigue);
      
      res.json({ 
        success: true,
        sigue 
      });
      
    } catch (error) {
      console.error('❌ Error al verificar:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error del servidor' 
      });
    }
  }

  // ⭐ LISTAR SEGUIDORES - CORREGIDO
  static async listarSeguidores(req, res) {
    try {
      const { id } = req.params;
      
      console.log('📥 Listar seguidores del usuario:', id);
      
      const seguidores = await Seguidor.obtenerSeguidores(id);
      
      console.log('✅ Seguidores encontrados:', seguidores.length);
      console.log('📋 Lista completa:', seguidores);
      
      // ⭐ IMPORTANTE: Agregar success: true
      res.json({ 
        success: true,
        total: seguidores.length, 
        seguidores 
      });
      
    } catch (error) {
      console.error('❌ Error al listar seguidores:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error del servidor',
        error: error.message 
      });
    }
  }

  // ⭐ LISTAR SEGUIDOS - CORREGIDO
  static async listarSeguidos(req, res) {
    try {
      const { id } = req.params;
      
      console.log('📥 Listar seguidos del usuario:', id);
      
      const seguidos = await Seguidor.obtenerSeguidos(id);
      
      console.log('✅ Seguidos encontrados:', seguidos.length);
      console.log('📋 Lista completa:', seguidos);
      
      // ⭐ IMPORTANTE: Agregar success: true
      res.json({ 
        success: true,
        total: seguidos.length, 
        seguidos 
      });
      
    } catch (error) {
      console.error('❌ Error al listar seguidos:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error del servidor',
        error: error.message 
      });
    }
  }
}

module.exports = SeguidoresController;