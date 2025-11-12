const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { proteger } = require('../middlewares/auth');

// 🆕 Configuración de S3
const S3_BUCKET_URL = 'https://redstudent-uploads.s3.us-east-2.amazonaws.com';

/**
 * @route   GET /api/fotos/mis-fotos
 * @desc    Obtener TODAS las fotos del usuario (actuales + historial completo)
 * @access  Private
 */
router.get('/mis-fotos', proteger, async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const usuario_id = req.usuario.id;

    // 1️⃣ Obtener datos del usuario
    const [usuario] = await connection.execute(
      `SELECT 
        foto_perfil_url,
        foto_portada_url,
        nombre_completo,
        nombre_usuario
       FROM usuarios 
       WHERE id = ?`,
      [usuario_id]
    );

    if (usuario.length === 0) {
      return res.status(404).json({
        success: false,
        mensaje: 'Usuario no encontrado'
      });
    }

    const datosUsuario = usuario[0];

    // 2️⃣ Obtener fotos de publicaciones
    const [publicaciones] = await connection.execute(
      `SELECT 
        id,
        imagen_url,
        imagen_s3,
        contenido,
        fecha_creacion
       FROM publicaciones 
       WHERE usuario_id = ? 
       AND (imagen_url IS NOT NULL OR imagen_s3 IS NOT NULL)
       ORDER BY fecha_creacion DESC`,
      [usuario_id]
    );

    // 🆕 Ya no usamos baseUrl local, usamos S3
    // const baseUrl = `${req.protocol}://${req.get('host')}`;

    // 3️⃣ Obtener TODAS las fotos de perfil del usuario (historial completo)
    const fotosPerfilHistorial = obtenerFotosHistorial('perfil', usuario_id);
    
    // 4️⃣ Obtener TODAS las fotos de portada del usuario (historial completo)
    const fotosPortadaHistorial = obtenerFotosHistorial('portadas', usuario_id);

    // 5️⃣ Identificar cuál es la foto actual de perfil y portada
    const fotoPerfilActual = construirUrlS3(datosUsuario.foto_perfil_url, 'perfil');
    const fotoPortadaActual = construirUrlS3(datosUsuario.foto_portada_url, 'portadas');

    // Marcar las fotos actuales en el historial
    fotosPerfilHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPerfilActual;
    });

    fotosPortadaHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPortadaActual;
    });

    // 6️⃣ Construcción de fotos de publicaciones con URLs de S3
    const fotosPublicaciones = publicaciones.map(pub => {
      let urlImagen = null;

      if (pub.imagen_s3) {
        urlImagen = construirUrlS3(pub.imagen_s3, 'publicaciones');
      } else if (pub.imagen_url) {
        urlImagen = construirUrlS3(pub.imagen_url, 'publicaciones');
      }

      return {
        id: pub.id,
        url: urlImagen,
        descripcion: pub.contenido
          ? pub.contenido.substring(0, 100) + (pub.contenido.length > 100 ? '...' : '')
          : '',
        fecha: pub.fecha_creacion,
        tipo: 'publicacion'
      };
    });

    // 7️⃣ Enviar respuesta con historial completo
    res.json({
      success: true,
      data: {
        usuario: {
          nombre_completo: datosUsuario.nombre_completo,
          nombre_usuario: datosUsuario.nombre_usuario
        },
        fotos: {
          // Fotos actuales
          perfil_actual: fotoPerfilActual ? { 
            url: fotoPerfilActual, 
            tipo: 'perfil',
            es_actual: true 
          } : null,
          portada_actual: fotoPortadaActual ? { 
            url: fotoPortadaActual, 
            tipo: 'portada',
            es_actual: true 
          } : null,
          
          // Historial completo de fotos de perfil
          perfil_historial: fotosPerfilHistorial,
          
          // Historial completo de fotos de portada
          portada_historial: fotosPortadaHistorial,
          
          // Fotos de publicaciones
          publicaciones: fotosPublicaciones
        },
        estadisticas: {
          total_fotos: fotosPerfilHistorial.length + fotosPortadaHistorial.length + fotosPublicaciones.length,
          fotos_perfil_total: fotosPerfilHistorial.length,
          fotos_portada_total: fotosPortadaHistorial.length,
          fotos_publicaciones: fotosPublicaciones.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener fotos:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener las fotos del usuario',
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * 🆕 Función auxiliar para construir URLs de S3
 */
function construirUrlS3(url, carpeta) {
  if (!url) return null;
  
  // Si ya es una URL completa de S3, retornarla
  if (url.includes('s3.us-east-2.amazonaws.com') || url.includes('s3.amazonaws.com')) {
    return url;
  }
  
  // Si es una URL completa de otro tipo, extraer solo el nombre del archivo
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const match = url.match(/\/uploads\/[^\/]+\/(.+)$/);
    if (match) {
      return `${S3_BUCKET_URL}/uploads/${carpeta}/${match[1]}`;
    }
  }
  
  // Si es una ruta relativa /uploads/...
  if (url.startsWith('/uploads/')) {
    const fileName = url.split('/').pop();
    return `${S3_BUCKET_URL}/uploads/${carpeta}/${fileName}`;
  }
  
  // Si es solo el nombre del archivo
  return `${S3_BUCKET_URL}/uploads/${carpeta}/${url}`;
}

/**
 *  Función auxiliar para obtener todas las fotos de una carpeta del usuario
 * Ahora devuelve URLs de S3 en lugar de URLs del servidor local
 */
function obtenerFotosHistorial(carpeta, usuario_id) {
  try {
    // CORRECCIÓN: Mapear correctamente los nombres de carpetas
    const carpetaMap = {
      'perfil': 'perfiles',      // Mapear 'perfil' a 'perfiles'
      'portadas': 'portadas'     // Mantener 'portadas' igual
    };
    
    const carpetaReal = carpetaMap[carpeta] || carpeta;
    const uploadsBase = path.join(__dirname, '../uploads', carpetaReal);
    
    console.log(`🔍 [DEBUG] Buscando fotos en: ${uploadsBase}`);
    console.log(`🔍 [DEBUG] Usuario ID: ${usuario_id}`);
    console.log(`🔍 [DEBUG] Carpeta: ${carpetaReal}`);
    
    if (!fs.existsSync(uploadsBase)) {
      console.warn(`⚠️ Carpeta no encontrada: ${uploadsBase}`);
      return [];
    }

    const tipo = carpeta === 'perfil' ? 'perfil' : 'portada';
    console.log(`🔍 [DEBUG] Tipo de foto: ${tipo}`);
    
    const todosLosArchivos = fs.readdirSync(uploadsBase);
    console.log(`🔍 [DEBUG] Total archivos en carpeta: ${todosLosArchivos.length}`);
    
    const archivos = todosLosArchivos
      .filter(archivo => {
        const esImagen = /\.(jpg|jpeg|png|gif|webp)$/i.test(archivo);
        if (!esImagen) return false;
        
        const patronNuevo = new RegExp(`foto_${tipo}-(\\d+)-(\\d+)\\.(jpg|jpeg|png|gif|webp)`, 'i');
        const matchNuevo = archivo.match(patronNuevo);
        
        if (matchNuevo) {
          const archivoUsuarioId = matchNuevo[1];
          
          // Si el primer número coincide con usuario_id, es formato nuevo
          if (archivoUsuarioId == usuario_id) {
            return true;
          }
          
          // Si el primer número es muy grande (timestamp), es formato antiguo
          if (parseInt(archivoUsuarioId) > 1600000000000) {
            return true;
          }
        }
        
        return false;
      })
      .map(archivo => {
        const rutaCompleta = path.join(uploadsBase, archivo);
        const stats = fs.statSync(rutaCompleta);
        
        const regex = new RegExp(`foto_${tipo}-(\\d+)-(\\d+)\\.`, 'i');
        const match = archivo.match(regex);
        
        let timestamp;
        let esFormatoNuevo = false;
        
        if (match) {
          const num1 = parseInt(match[1]);
          const num2 = parseInt(match[2]);
          
          if (num1 == usuario_id) {
            timestamp = num2;
            esFormatoNuevo = true;
          } else {
            timestamp = num1;
            esFormatoNuevo = false;
          }
        } else {
          timestamp = stats.birthtimeMs;
        }
        
        // 🆕 Construir URL de S3 en lugar de URL local
        return {
          nombre: archivo,
          url: `${S3_BUCKET_URL}/${carpetaReal}/${archivo}`,
          fecha: new Date(timestamp),
          tamaño: stats.size,
          tipo: tipo,
          es_actual: false,
          formato: esFormatoNuevo ? 'nuevo' : 'antiguo'
        };
      })
      .sort((a, b) => b.fecha - a.fecha);

    console.log(`✅ Total de fotos de ${tipo} encontradas: ${archivos.length}`);
    console.log(`📋 URLs de S3 generadas:`, archivos.slice(0, 3).map(a => a.url));
    
    return archivos;
  } catch (error) {
    console.error(`❌ Error al obtener historial de ${carpeta}:`, error);
    return [];
  }
}

/**
 * @route   GET /api/fotos/usuario/:usuario_id
 * @desc    Obtener fotos de un usuario específico (público)
 * @access  Public
 */
router.get('/usuario/:usuario_id', async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { usuario_id } = req.params;

    const [usuario] = await connection.execute(
      `SELECT 
        foto_perfil_url,
        foto_portada_url,
        nombre_completo,
        nombre_usuario
       FROM usuarios 
       WHERE id = ?`,
      [usuario_id]
    );

    if (usuario.length === 0) {
      return res.status(404).json({
        success: false,
        mensaje: 'Usuario no encontrado'
      });
    }

    const datosUsuario = usuario[0];

    const [publicaciones] = await connection.execute(
      `SELECT 
        id,
        imagen_url,
        imagen_s3,
        contenido,
        fecha_creacion
       FROM publicaciones 
       WHERE usuario_id = ? 
       AND (imagen_url IS NOT NULL OR imagen_s3 IS NOT NULL)
       ORDER BY fecha_creacion DESC`,
      [usuario_id]
    );

    const fotosPerfilHistorial = obtenerFotosHistorial('perfil', usuario_id);
    const fotosPortadaHistorial = obtenerFotosHistorial('portadas', usuario_id);

    const fotoPerfilActual = construirUrlS3(datosUsuario.foto_perfil_url, 'perfil');
    const fotoPortadaActual = construirUrlS3(datosUsuario.foto_portada_url, 'portadas');

    fotosPerfilHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPerfilActual;
    });

    fotosPortadaHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPortadaActual;
    });

    const fotosPublicaciones = publicaciones.map(pub => {
      let urlImagen = null;

      if (pub.imagen_s3) {
        urlImagen = construirUrlS3(pub.imagen_s3, 'publicaciones');
      } else if (pub.imagen_url) {
        urlImagen = construirUrlS3(pub.imagen_url, 'publicaciones');
      }

      return {
        id: pub.id,
        url: urlImagen,
        descripcion: pub.contenido
          ? pub.contenido.substring(0, 100) + (pub.contenido.length > 100 ? '...' : '')
          : '',
        fecha: pub.fecha_creacion,
        tipo: 'publicacion'
      };
    });

    res.json({
      success: true,
      data: {
        usuario: {
          nombre_completo: datosUsuario.nombre_completo,
          nombre_usuario: datosUsuario.nombre_usuario
        },
        fotos: {
          perfil_actual: fotoPerfilActual ? { 
            url: fotoPerfilActual, 
            tipo: 'perfil',
            es_actual: true 
          } : null,
          portada_actual: fotoPortadaActual ? { 
            url: fotoPortadaActual, 
            tipo: 'portada',
            es_actual: true 
          } : null,
          perfil_historial: fotosPerfilHistorial,
          portada_historial: fotosPortadaHistorial,
          publicaciones: fotosPublicaciones
        },
        estadisticas: {
          total_fotos: fotosPerfilHistorial.length + fotosPortadaHistorial.length + fotosPublicaciones.length,
          fotos_perfil_total: fotosPerfilHistorial.length,
          fotos_portada_total: fotosPortadaHistorial.length,
          fotos_publicaciones: fotosPublicaciones.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener fotos del usuario:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener las fotos',
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * @route   GET /api/fotos/historial/:tipo
 * @desc    Obtener historial de fotos de perfil o portada
 * @access  Private
 */
router.get('/historial/:tipo', proteger, async (req, res) => {
  try {
    const { tipo } = req.params;
    const usuario_id = req.usuario.id;

    if (!['perfil', 'portada'].includes(tipo)) {
      return res.status(400).json({
        success: false,
        mensaje: 'Tipo inválido. Use: perfil o portada'
      });
    }

    const carpeta = tipo === 'perfil' ? 'perfil' : 'portadas';
    const fotos = obtenerFotosHistorial(carpeta, usuario_id);

    res.json({
      success: true,
      data: {
        tipo,
        total: fotos.length,
        fotos: fotos
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener historial:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener el historial de fotos',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/fotos/eliminar/:tipo/:filename
 * @desc    Eliminar una foto específica del historial
 * @access  Private
 */
router.delete('/eliminar/:tipo/:filename', proteger, async (req, res) => {
  let connection;
  try {
    const { tipo, filename } = req.params;
    const usuario_id = req.usuario.id;

    if (!['perfil', 'portada', 'publicacion'].includes(tipo)) {
      return res.status(400).json({
        success: false,
        mensaje: 'Tipo inválido'
      });
    }

    const carpetaMap = {
  perfil: 'perfiles',
  portada: 'portadas',
  publicacion: 'publicaciones'
};


    const carpeta = carpetaMap[tipo];
    const rutaArchivo = path.join(__dirname, '../uploads', carpeta, filename);

    if (!fs.existsSync(rutaArchivo)) {
      return res.status(404).json({
        success: false,
        mensaje: 'Archivo no encontrado'
      });
    }

    connection = await db.getConnection();

    if (tipo === 'perfil' || tipo === 'portada') {
      const columna = tipo === 'perfil' ? 'foto_perfil_url' : 'foto_portada_url';
      const [usuario] = await connection.execute(
        `SELECT ${columna} FROM usuarios WHERE id = ?`,
        [usuario_id]
      );

      if (usuario[0][columna] && usuario[0][columna].includes(filename)) {
        return res.status(400).json({
          success: false,
          mensaje: 'No puedes eliminar tu foto actual. Primero cambia tu foto.'
        });
      }
    }

    fs.unlinkSync(rutaArchivo);
    console.log('🗑️ Foto eliminada del historial:', filename);

    res.json({
      success: true,
      mensaje: 'Foto eliminada correctamente del historial'
    });

  } catch (error) {
    console.error('❌ Error al eliminar foto:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al eliminar la foto',
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;