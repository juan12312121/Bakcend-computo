// =============================================================================
// src/routes/fotosRoutes.js - VERSIÓN CORREGIDA PARA ALMACENAMIENTO LOCAL
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { proteger } = require('../middlewares/auth');

/**
 * Función auxiliar para construir URLs locales
 * ⚠️ CAMBIO: Ya no usa S3, usa el servidor local
 */
function construirUrlLocal(urlBD, tipo = 'perfil') {
  if (!urlBD) return null;
  
  console.log('🔧 construirUrlLocal - INPUT:', { urlBD, tipo });
  
  // Si ya es una URL completa (http://... o https://...), devolverla tal cual
  if (urlBD.startsWith('http://') || urlBD.startsWith('https://')) {
    console.log('✅ URL completa detectada:', urlBD);
    return urlBD;
  }
  
  // Si es una ruta relativa que empieza con /uploads/
  if (urlBD.startsWith('/uploads/')) {
    console.log('✅ Ruta relativa válida:', urlBD);
    return urlBD; // El servidor ya la sirve con express.static
  }
  
  // Si no tiene el prefijo /uploads/, agregarlo
  if (urlBD.startsWith('uploads/')) {
    const url = `/${urlBD}`;
    console.log('✅ URL construida:', url);
    return url;
  }
  
  // Si es solo el nombre del archivo, construir la ruta completa
  let carpeta = 'publicaciones';
  if (tipo === 'perfil') {
    carpeta = 'perfiles';
  } else if (tipo === 'portada') {
    carpeta = 'portadas';
  }
  
  const url = `/uploads/${carpeta}/${urlBD}`;
  console.log('✅ URL construida con tipo:', url);
  return url;
}

// =============================================================================
// ENDPOINTS PÚBLICOS (sin autenticación requerida)
// =============================================================================

/**
 * @route   GET /api/fotos/usuario/:usuario_id
 * @desc    Obtiene todas las fotos de un usuario específico (PÚBLICO)
 * @access  Public
 */
router.get('/usuario/:usuario_id', async (req, res) => {
  let connection;
  try {
    const { usuario_id } = req.params;

    console.log('========================================');
    console.log('📸 Obteniendo fotos del usuario:', usuario_id);
    console.log('🔓 Acceso PÚBLICO (sin autenticación)');
    console.log('========================================');

    connection = await db.getConnection();

    // =============================================
    // 1. OBTENER DATOS DEL USUARIO
    // =============================================
    const [usuario] = await connection.execute(
      `SELECT 
        nombre_completo, 
        nombre_usuario, 
        foto_perfil_url, 
        foto_portada_url
       FROM usuarios 
       WHERE id = ?`,
      [usuario_id]
    );

    if (usuario.length === 0) {
      console.log('❌ Usuario no encontrado:', usuario_id);
      return res.status(404).json({
        success: false,
        mensaje: 'Usuario no encontrado'
      });
    }

    const datosUsuario = usuario[0];
    console.log('✅ Usuario encontrado:', datosUsuario.nombre_completo);

    // =============================================
    // 2. CONSTRUIR FOTO DE PERFIL ACTUAL
    // =============================================
    const perfilHistorial = [];
    if (datosUsuario.foto_perfil_url) {
      perfilHistorial.push({
        nombre: datosUsuario.foto_perfil_url,
        url: construirUrlLocal(datosUsuario.foto_perfil_url, 'perfil'),
        fecha: new Date().toISOString(),
        tamaño: 0,
        tipo: 'perfil',
        es_actual: true,
        formato: 'jpg'
      });
      console.log('📸 Foto de perfil:', datosUsuario.foto_perfil_url);
    } else {
      console.log('⚠️ Usuario sin foto de perfil');
    }

    // =============================================
    // 3. CONSTRUIR FOTO DE PORTADA ACTUAL
    // =============================================
    const portadaHistorial = [];
    if (datosUsuario.foto_portada_url) {
      portadaHistorial.push({
        nombre: datosUsuario.foto_portada_url,
        url: construirUrlLocal(datosUsuario.foto_portada_url, 'portada'),
        fecha: new Date().toISOString(),
        tamaño: 0,
        tipo: 'portada',
        es_actual: true,
        formato: 'jpg'
      });
      console.log('🖼️ Foto de portada:', datosUsuario.foto_portada_url);
    } else {
      console.log('⚠️ Usuario sin foto de portada');
    }

    // =============================================
    // 4. OBTENER FOTOS DE PUBLICACIONES PÚBLICAS
    // ⚠️ CAMBIO: Ahora usa imagen_url en lugar de imagen_s3
    // =============================================
    const [publicacionesConFotos] = await connection.execute(
      `SELECT 
        id,
        imagen_url as url,
        contenido as descripcion,
        fecha_creacion as fecha
       FROM publicaciones
       WHERE usuario_id = ? 
       AND imagen_url IS NOT NULL
       AND imagen_url != ''
       AND oculto = 0
       AND visibilidad IN ('publico', 'seguidores')
       ORDER BY fecha_creacion DESC
       LIMIT 100`,
      [usuario_id]
    );

    console.log('📷 Publicaciones con fotos encontradas:', publicacionesConFotos.length);

    // =============================================
    // 5. CONSTRUIR RESPUESTA
    // =============================================
    const publicaciones = publicacionesConFotos.map(p => ({
      id: p.id,
      url: construirUrlLocal(p.url, 'publicacion'),
      descripcion: p.descripcion ? p.descripcion.substring(0, 100) : '',
      fecha: p.fecha,
      tipo: 'publicacion'
    }));

    const totalFotos = perfilHistorial.length + portadaHistorial.length + publicaciones.length;

    const respuesta = {
      success: true,
      data: {
        usuario: {
          nombre_completo: datosUsuario.nombre_completo,
          nombre_usuario: datosUsuario.nombre_usuario
        },
        fotos: {
          perfil_actual: perfilHistorial[0] || null,
          portada_actual: portadaHistorial[0] || null,
          perfil_historial: perfilHistorial,
          portada_historial: portadaHistorial,
          publicaciones: publicaciones
        },
        estadisticas: {
          total_fotos: totalFotos,
          fotos_perfil_total: perfilHistorial.length,
          fotos_portada_total: portadaHistorial.length,
          fotos_publicaciones: publicaciones.length
        }
      }
    };

    console.log('========================================');
    console.log('✅ RESPUESTA CONSTRUIDA EXITOSAMENTE');
    console.log('========================================');
    console.log('📊 Total de fotos:', totalFotos);
    console.log('👤 Fotos de perfil:', perfilHistorial.length);
    console.log('🖼️ Fotos de portada:', portadaHistorial.length);
    console.log('📷 Fotos de publicaciones:', publicaciones.length);
    console.log('========================================');

    res.json(respuesta);

  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR AL OBTENER FOTOS');
    console.error('========================================');
    console.error('Error completo:', error);
    console.error('Mensaje:', error.message);
    console.error('Stack:', error.stack);
    console.error('========================================');
    
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener fotos del usuario',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor'
    });
  } finally {
    if (connection) {
      connection.release();
      console.log('🔓 Conexión liberada');
    }
  }
});

/**
 * @route   GET /api/fotos/usuario/:usuario_id/foto-perfil-simple
 * @desc    Obtiene solo la URL de la foto de perfil actual de un usuario
 * @access  Public
 */
router.get('/usuario/:usuario_id/foto-perfil-simple', async (req, res) => {
  let connection;
  try {
    const { usuario_id } = req.params;

    console.log('📸 Obteniendo foto de perfil del usuario:', usuario_id);

    connection = await db.getConnection();

    const [usuario] = await connection.execute(
      `SELECT 
        id,
        nombre_completo,
        nombre_usuario,
        foto_perfil_url
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

    const fotoPerfilUrl = datosUsuario.foto_perfil_url 
      ? construirUrlLocal(datosUsuario.foto_perfil_url, 'perfil')
      : null;

    res.json({
      success: true,
      data: {
        id: datosUsuario.id,
        nombre_completo: datosUsuario.nombre_completo,
        nombre_usuario: datosUsuario.nombre_usuario,
        foto_perfil_url: fotoPerfilUrl
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener foto de perfil:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener foto de perfil',
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * @route   POST /api/fotos/usuarios/fotos-batch
 * @desc    Obtiene fotos de perfil de múltiples usuarios en una sola petición
 * @access  Public
 * ⚠️ IMPORTANTE: Este endpoint es el que está dando timeout
 */
router.post('/usuarios/fotos-batch', async (req, res) => {
  let connection;
  try {
    const { usuarios_ids } = req.body;

    console.log('========================================');
    console.log('📸 BATCH: Solicitud recibida');
    console.log('IDs recibidos:', usuarios_ids);
    console.log('========================================');

    // ⚠️ VALIDACIÓN MEJORADA
    if (!usuarios_ids) {
      console.log('❌ No se envió usuarios_ids');
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el campo usuarios_ids'
      });
    }

    if (!Array.isArray(usuarios_ids)) {
      console.log('❌ usuarios_ids no es un array:', typeof usuarios_ids);
      return res.status(400).json({
        success: false,
        mensaje: 'usuarios_ids debe ser un array'
      });
    }

    if (usuarios_ids.length === 0) {
      console.log('⚠️ Array vacío, devolviendo array vacío');
      return res.json({
        success: true,
        data: []
      });
    }

    // Limitar a 50 usuarios por request
    const idsLimitados = usuarios_ids.slice(0, 50);
    console.log('📊 Procesando', idsLimitados.length, 'usuarios');

    connection = await db.getConnection();

    const placeholders = idsLimitados.map(() => '?').join(',');

    const [usuarios] = await connection.execute(
      `SELECT 
        id,
        nombre_completo,
        nombre_usuario,
        foto_perfil_url
       FROM usuarios
       WHERE id IN (${placeholders})`,
      idsLimitados
    );

    console.log('✅ Usuarios encontrados:', usuarios.length);

    const resultado = usuarios.map(u => {
      const fotoUrl = construirUrlLocal(u.foto_perfil_url, 'perfil');
      console.log(`👤 ${u.nombre_usuario}: ${fotoUrl}`);
      
      return {
        id: u.id,
        nombre_completo: u.nombre_completo,
        nombre_usuario: u.nombre_usuario,
        foto_perfil_url: fotoUrl
      };
    });

    console.log('========================================');
    console.log('✅ BATCH completado exitosamente');
    console.log('========================================');

    res.json({
      success: true,
      data: resultado
    });

  } catch (error) {
    console.error('========================================');
    console.error('❌ ERROR EN BATCH');
    console.error('========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('========================================');
    
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener fotos de usuarios',
      error: error.message
    });
  } finally {
    if (connection) {
      connection.release();
      console.log('🔓 Conexión liberada');
    }
  }
});

// =============================================================================
// 🔒 ENDPOINTS PROTEGIDOS (requieren autenticación)
// =============================================================================

/**
 * @route   GET /api/fotos/mis-fotos
 * @desc    Obtiene todas las fotos del usuario autenticado
 * @access  Private
 */
router.get('/mis-fotos', proteger, async (req, res) => {
  let connection;
  try {
    const usuario_id = req.usuario?.id;

    console.log('========================================');
    console.log('📸 Obteniendo MIS fotos (autenticado)');
    console.log('👤 Usuario:', usuario_id);
    console.log('========================================');

    connection = await db.getConnection();

    // Obtener datos del usuario
    const [usuario] = await connection.execute(
      `SELECT 
        nombre_completo, 
        nombre_usuario, 
        foto_perfil_url, 
        foto_portada_url
       FROM usuarios 
       WHERE id = ?`,
      [usuario_id]
    );

    if (usuario.length === 0) {
      console.log('❌ Usuario no encontrado:', usuario_id);
      return res.status(404).json({
        success: false,
        mensaje: 'Usuario no encontrado'
      });
    }

    const datosUsuario = usuario[0];

    // Construir foto de perfil
    const perfilHistorial = [];
    if (datosUsuario.foto_perfil_url) {
      perfilHistorial.push({
        nombre: datosUsuario.foto_perfil_url,
        url: construirUrlLocal(datosUsuario.foto_perfil_url, 'perfil'),
        fecha: new Date().toISOString(),
        tamaño: 0,
        tipo: 'perfil',
        es_actual: true,
        formato: 'jpg'
      });
    }

    // Construir foto de portada
    const portadaHistorial = [];
    if (datosUsuario.foto_portada_url) {
      portadaHistorial.push({
        nombre: datosUsuario.foto_portada_url,
        url: construirUrlLocal(datosUsuario.foto_portada_url, 'portada'),
        fecha: new Date().toISOString(),
        tamaño: 0,
        tipo: 'portada',
        es_actual: true,
        formato: 'jpg'
      });
    }

    // Obtener fotos de publicaciones (incluye privadas)
    const [publicacionesConFotos] = await connection.execute(
      `SELECT 
        id,
        imagen_url as url,
        contenido as descripcion,
        fecha_creacion as fecha
       FROM publicaciones
       WHERE usuario_id = ? 
       AND imagen_url IS NOT NULL
       AND imagen_url != ''
       AND oculto = 0
       ORDER BY fecha_creacion DESC
       LIMIT 100`,
      [usuario_id]
    );

    const publicaciones = publicacionesConFotos.map(p => ({
      id: p.id,
      url: construirUrlLocal(p.url, 'publicacion'),
      descripcion: p.descripcion ? p.descripcion.substring(0, 100) : '',
      fecha: p.fecha,
      tipo: 'publicacion'
    }));

    const totalFotos = perfilHistorial.length + portadaHistorial.length + publicaciones.length;

    res.json({
      success: true,
      data: {
        usuario: {
          nombre_completo: datosUsuario.nombre_completo,
          nombre_usuario: datosUsuario.nombre_usuario
        },
        fotos: {
          perfil_actual: perfilHistorial[0] || null,
          portada_actual: portadaHistorial[0] || null,
          perfil_historial: perfilHistorial,
          portada_historial: portadaHistorial,
          publicaciones: publicaciones
        },
        estadisticas: {
          total_fotos: totalFotos,
          fotos_perfil_total: perfilHistorial.length,
          fotos_portada_total: portadaHistorial.length,
          fotos_publicaciones: publicaciones.length
        }
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener mis fotos:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener fotos',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
    });
  } finally {
    if (connection) connection.release();
  }
});

// =============================================================================
// EXPORTAR ROUTER
// =============================================================================
module.exports = router;