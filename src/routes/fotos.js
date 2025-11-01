const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { proteger } = require('../middlewares/auth');

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

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // 3️⃣ Obtener TODAS las fotos de perfil del usuario (historial completo)
    const fotosPerfilHistorial = obtenerFotosHistorial('perfiles', usuario_id, baseUrl);
    
    // 4️⃣ Obtener TODAS las fotos de portada del usuario (historial completo)
    const fotosPortadaHistorial = obtenerFotosHistorial('portadas', usuario_id, baseUrl);

    // 5️⃣ Identificar cuál es la foto actual de perfil y portada
    const fotoPerfilActual = datosUsuario.foto_perfil_url
      ? (datosUsuario.foto_perfil_url.startsWith('http')
          ? datosUsuario.foto_perfil_url
          : `${baseUrl}${datosUsuario.foto_perfil_url}`)
      : null;

    const fotoPortadaActual = datosUsuario.foto_portada_url
      ? (datosUsuario.foto_portada_url.startsWith('http')
          ? datosUsuario.foto_portada_url
          : `${baseUrl}${datosUsuario.foto_portada_url}`)
      : null;

    // Marcar las fotos actuales en el historial
    fotosPerfilHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPerfilActual;
    });

    fotosPortadaHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPortadaActual;
    });

    // 6️⃣ Construcción de fotos de publicaciones
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
 * Función auxiliar para obtener todas las fotos de una carpeta del usuario
 * Funciona con ambos formatos:
 * - Nuevo: foto_perfil-{usuario_id}-{timestamp}.jpg
 * - Antiguo: foto_perfil-{timestamp}-{random}.jpg (devuelve todas sin filtrar)
 */
function obtenerFotosHistorial(carpeta, usuario_id, baseUrl) {
  try {
    // __dirname aquí es: /home/ubuntu/Bakcend-computo/src/routes
    // Necesitamos subir un nivel y entrar a uploads: ../uploads
    const uploadsBase = path.join(__dirname, '../uploads', carpeta);
    
    console.log(`🔍 [DEBUG] Buscando fotos en: ${uploadsBase}`);
    console.log(`🔍 [DEBUG] Usuario ID: ${usuario_id}`);
    console.log(`🔍 [DEBUG] Carpeta: ${carpeta}`);
    
    // Verificar que la carpeta exista
    if (!fs.existsSync(uploadsBase)) {
      console.warn(`⚠️ Carpeta no encontrada: ${uploadsBase}`);
      return [];
    }

    const tipo = carpeta === 'perfiles' ? 'perfil' : 'portada';
    console.log(`🔍 [DEBUG] Tipo de foto: ${tipo}`);
    
    // Leer TODOS los archivos primero (sin filtrar)
    const todosLosArchivos = fs.readdirSync(uploadsBase);
    console.log(`🔍 [DEBUG] Total archivos en carpeta: ${todosLosArchivos.length}`);
    console.log(`🔍 [DEBUG] Archivos encontrados:`, todosLosArchivos);
    
    // Leer todos los archivos de la carpeta
    const archivos = todosLosArchivos
      .filter(archivo => {
        console.log(`🔍 [DEBUG] Procesando archivo: ${archivo}`);
        
        // Filtrar solo archivos de imagen válidos
        const esImagen = /\.(jpg|jpeg|png|gif|webp)$/i.test(archivo);
        console.log(`  - ¿Es imagen?: ${esImagen}`);
        
        if (!esImagen) return false;
        
        // Patrón NUEVO: foto_perfil-{usuario_id}-{timestamp}.ext
        const patronNuevo = new RegExp(`foto_${tipo}-(\\d+)-(\\d+)\\.(jpg|jpeg|png|gif|webp)`, 'i');
        const matchNuevo = archivo.match(patronNuevo);
        
        console.log(`  - Patrón buscado: foto_${tipo}-(\\d+)-(\\d+)`);
        console.log(`  - ¿Coincide patrón?: ${matchNuevo ? 'SÍ' : 'NO'}`);
        
        if (matchNuevo) {
          const archivoUsuarioId = matchNuevo[1];
          const timestamp = matchNuevo[2];
          
          console.log(`  - Usuario ID en archivo: ${archivoUsuarioId}`);
          console.log(`  - Timestamp: ${timestamp}`);
          console.log(`  - ¿Coincide usuario?: ${archivoUsuarioId == usuario_id}`);
          
          // Si el primer número coincide con usuario_id, es formato nuevo
          if (archivoUsuarioId == usuario_id) {
            console.log(`  ✅ INCLUIDO - Formato nuevo del usuario`);
            return true;
          }
          
          // Si el primer número es muy grande (timestamp), es formato antiguo
          // Timestamps > 1600000000000 (año 2020)
          if (parseInt(archivoUsuarioId) > 1600000000000) {
            console.log(`  ✅ INCLUIDO - Archivo formato antiguo`);
            return true; // Incluir archivos antiguos sin filtro
          }
          
          console.log(`  ❌ EXCLUIDO - No cumple criterios`);
        }
        
        return false;
      })
      .map(archivo => {
        const rutaCompleta = path.join(uploadsBase, archivo);
        const stats = fs.statSync(rutaCompleta);
        
        // Extraer datos del nombre: foto_perfil-{num1}-{num2}.ext
        const regex = new RegExp(`foto_${tipo}-(\\d+)-(\\d+)\\.`, 'i');
        const match = archivo.match(regex);
        
        let timestamp;
        let esFormatoNuevo = false;
        
        if (match) {
          const num1 = parseInt(match[1]);
          const num2 = parseInt(match[2]);
          
          // Determinar si es formato nuevo o antiguo
          if (num1 == usuario_id) {
            // Formato nuevo: foto_perfil-{usuario_id}-{timestamp}.ext
            timestamp = num2;
            esFormatoNuevo = true;
          } else {
            // Formato antiguo: foto_perfil-{timestamp}-{random}.ext
            timestamp = num1;
            esFormatoNuevo = false;
          }
        } else {
          timestamp = stats.birthtimeMs;
        }
        
        return {
          nombre: archivo,
          url: `${baseUrl}/uploads/${carpeta}/${archivo}`,
          fecha: new Date(timestamp),
          tamaño: stats.size,
          tipo: tipo,
          es_actual: false, // Se marcará después si es la foto actual
          formato: esFormatoNuevo ? 'nuevo' : 'antiguo'
        };
      })
      .sort((a, b) => b.fecha - a.fecha); // Ordenar por fecha descendente

    console.log(`✅ Total de fotos de ${tipo} encontradas para usuario ${usuario_id}: ${archivos.length}`);
    console.log(`📋 Fotos resultantes:`, archivos.map(a => a.nombre));
    
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

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // 3️⃣ Obtener TODAS las fotos de perfil del usuario (historial completo)
    const fotosPerfilHistorial = obtenerFotosHistorial('perfiles', usuario_id, baseUrl);
    
    // 4️⃣ Obtener TODAS las fotos de portada del usuario (historial completo)
    const fotosPortadaHistorial = obtenerFotosHistorial('portadas', usuario_id, baseUrl);

    // 5️⃣ Identificar cuál es la foto actual de perfil y portada
    const fotoPerfilActual = datosUsuario.foto_perfil_url
      ? (datosUsuario.foto_perfil_url.startsWith('http')
          ? datosUsuario.foto_perfil_url
          : `${baseUrl}${datosUsuario.foto_perfil_url}`)
      : null;

    const fotoPortadaActual = datosUsuario.foto_portada_url
      ? (datosUsuario.foto_portada_url.startsWith('http')
          ? datosUsuario.foto_portada_url
          : `${baseUrl}${datosUsuario.foto_portada_url}`)
      : null;

    // Marcar las fotos actuales en el historial
    fotosPerfilHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPerfilActual;
    });

    fotosPortadaHistorial.forEach(foto => {
      foto.es_actual = foto.url === fotoPortadaActual;
    });

    // 6️⃣ Construcción de fotos de publicaciones
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

    // 7️⃣ Enviar respuesta con historial completo (igual que /mis-fotos)
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
    const uploadsBase = path.join(__dirname, '../uploads');
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

    const carpeta = tipo === 'perfil' ? 'perfiles' : 'portadas';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    const fotos = obtenerFotosHistorial(carpeta, usuario_id, baseUrl);

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

// 🔍 Función auxiliar para verificar existencia de archivos
function verificarArchivoExiste(urlRelativa) {
  try {
    if (!urlRelativa || urlRelativa.startsWith('http')) return true;
    const uploadsBase = path.join(__dirname, '../uploads');
    const rutaCompleta = path.join(uploadsBase, urlRelativa.replace('/uploads/', ''));
    return fs.existsSync(rutaCompleta);
  } catch {
    return false;
  }
}

module.exports = router;