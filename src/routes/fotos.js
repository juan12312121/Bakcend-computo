// ==================== ARCHIVO: routes/fotos.js ====================
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { proteger } = require('../middlewares/auth');

/**
 * @route   GET /api/fotos/mis-fotos
 * @desc    Obtener todas las fotos del usuario autenticado
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

    // 2️⃣ Obtener fotos de publicaciones (CAMBIO: fecha_creacion en lugar de fecha_publicacion)
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

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // 3️⃣ Construcción de URLs completas
    const fotoPerfil = datosUsuario.foto_perfil_url
      ? (datosUsuario.foto_perfil_url.startsWith('http')
          ? datosUsuario.foto_perfil_url
          : `${baseUrl}${datosUsuario.foto_perfil_url}`)
      : null;

    const fotoPortada = datosUsuario.foto_portada_url
      ? (datosUsuario.foto_portada_url.startsWith('http')
          ? datosUsuario.foto_portada_url
          : `${baseUrl}${datosUsuario.foto_portada_url}`)
      : null;

    const fotosPublicaciones = publicaciones.map(pub => {
      let urlImagen = null;

      if (pub.imagen_s3) {
        urlImagen = pub.imagen_s3.startsWith('http')
          ? pub.imagen_s3
          : `${baseUrl}${pub.imagen_s3}`;
      } else if (pub.imagen_url) {
        urlImagen = pub.imagen_url.startsWith('http')
          ? pub.imagen_url
          : `${baseUrl}${pub.imagen_url}`;
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

    // 4️⃣ Verificar existencia física de fotos locales
    const perfilExiste = fotoPerfil ? await verificarArchivoExiste(datosUsuario.foto_perfil_url) : false;
    const portadaExiste = fotoPortada ? await verificarArchivoExiste(datosUsuario.foto_portada_url) : false;

    // 5️⃣ Enviar respuesta
    res.json({
      success: true,
      data: {
        usuario: {
          nombre_completo: datosUsuario.nombre_completo,
          nombre_usuario: datosUsuario.nombre_usuario
        },
        fotos: {
          perfil: fotoPerfil ? { url: fotoPerfil, tipo: 'perfil', existe: perfilExiste } : null,
          portada: fotoPortada ? { url: fotoPortada, tipo: 'portada', existe: portadaExiste } : null,
          publicaciones: fotosPublicaciones
        },
        estadisticas: {
          total_fotos: (fotoPerfil ? 1 : 0) + (fotoPortada ? 1 : 0) + fotosPublicaciones.length,
          fotos_perfil: fotoPerfil ? 1 : 0,
          fotos_portada: fotoPortada ? 1 : 0,
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
 * @route   GET /api/fotos/usuario/:usuario_id
 * @desc    Obtener fotos de un usuario específico (público)
 * @access  Public
 */
router.get('/usuario/:usuario_id', async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const { usuario_id } = req.params;

    // Verificar que el usuario existe
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

    // Obtener publicaciones del usuario (CAMBIO: fecha_creacion)
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

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fotoPerfil = datosUsuario.foto_perfil_url
      ? (datosUsuario.foto_perfil_url.startsWith('http')
          ? datosUsuario.foto_perfil_url
          : `${baseUrl}${datosUsuario.foto_perfil_url}`)
      : null;

    const fotoPortada = datosUsuario.foto_portada_url
      ? (datosUsuario.foto_portada_url.startsWith('http')
          ? datosUsuario.foto_portada_url
          : `${baseUrl}${datosUsuario.foto_portada_url}`)
      : null;

    const fotosPublicaciones = publicaciones.map(pub => {
      let urlImagen = null;

      if (pub.imagen_s3) {
        urlImagen = pub.imagen_s3.startsWith('http')
          ? pub.imagen_s3
          : `${baseUrl}${pub.imagen_s3}`;
      } else if (pub.imagen_url) {
        urlImagen = pub.imagen_url.startsWith('http')
          ? pub.imagen_url
          : `${baseUrl}${pub.imagen_url}`;
      }

      return {
        id: pub.id,
        url: urlImagen,
        descripcion: pub.contenido ? pub.contenido.substring(0, 100) : '',
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
          perfil: fotoPerfil ? { url: fotoPerfil, tipo: 'perfil' } : null,
          portada: fotoPortada ? { url: fotoPortada, tipo: 'portada' } : null,
          publicaciones: fotosPublicaciones
        },
        estadisticas: {
          total_fotos: (fotoPerfil ? 1 : 0) + (fotoPortada ? 1 : 0) + fotosPublicaciones.length,
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
 * @route   GET /api/fotos/verificar/:tipo/:filename
 * @desc    Verificar si una foto existe físicamente
 * @access  Public
 */
router.get('/verificar/:tipo/:filename', (req, res) => {
  try {
    const { tipo, filename } = req.params;
    const uploadsBase = path.join(__dirname, '../../uploads');
    let carpeta;

    switch (tipo) {
      case 'perfil': carpeta = 'perfiles'; break;
      case 'portada': carpeta = 'portadas'; break;
      case 'publicacion': carpeta = 'publicaciones'; break;
      default:
        return res.status(400).json({
          success: false,
          mensaje: 'Tipo de foto inválido. Use: perfil, portada o publicacion'
        });
    }

    const rutaArchivo = path.join(uploadsBase, carpeta, filename);
    const existe = fs.existsSync(rutaArchivo);

    res.json({
      success: true,
      data: {
        existe,
        ruta: `/uploads/${carpeta}/${filename}`,
        url_completa: `${req.protocol}://${req.get('host')}/uploads/${carpeta}/${filename}`,
        tipo,
        filename
      }
    });
  } catch (error) {
    console.error('❌ Error al verificar archivo:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al verificar el archivo',
      error: error.message
    });
  }
});

// 🔍 Función auxiliar
function verificarArchivoExiste(urlRelativa) {
  try {
    if (!urlRelativa || urlRelativa.startsWith('http')) return true;
    const uploadsBase = path.join(__dirname, '../../uploads');
    const rutaCompleta = path.join(uploadsBase, urlRelativa.replace('/uploads/', ''));
    return fs.existsSync(rutaCompleta);
  } catch {
    return false;
  }
}

module.exports = router;
