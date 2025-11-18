// =============================================================================
// src/routes/fotos.js - ARCHIVO COMPLETO ACTUALIZADO
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { proteger } = require('../middlewares/auth');

/**
 * Función auxiliar para construir URLs de S3
 */
function construirUrlS3(key, tipo = 'perfil') {
  if (!key) return null;
  
  console.log('🔧 construirUrlS3 - INPUT:', { key, tipo });
  
  // ✅ Si ya es una URL completa de S3, devolverla tal cual
  if (key.includes('s3.amazonaws.com') || key.includes('s3.us-east-2.amazonaws.com')) {
    console.log('✅ URL S3 completa detectada, devolviendo tal cual:', key);
    return key;
  }
  
  const bucket = process.env.AWS_S3_BUCKET || 'redstudent-uploads';
  const region = process.env.AWS_REGION || 'us-east-2';
  
  // Si empieza con uploads/, úsala directamente
  if (key.startsWith('uploads/')) {
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    console.log('✅ URL construida con uploads/:', url);
    return url;
  }
  
  // Si empieza con perfiles/, publicaciones/ o portadas/
  if (key.startsWith('perfiles/') || key.startsWith('publicaciones/') || key.startsWith('portadas/')) {
    const url = `https://${bucket}.s3.${region}.amazonaws.com/uploads/${key}`;
    console.log('✅ URL construida con carpeta específica:', url);
    return url;
  }
  
  // Si no, construir la ruta según el tipo
  let carpeta = 'publicaciones';
  if (tipo === 'perfil') {
    carpeta = 'perfiles';
  } else if (tipo === 'portada') {
    carpeta = 'portadas';
  }
  
  const url = `https://${bucket}.s3.${region}.amazonaws.com/uploads/${carpeta}/${key}`;
  console.log('✅ URL construida con tipo:', url);
  return url;
}

// =============================================================================
// ENDPOINTS PÚBLICOS (sin autenticación)
// =============================================================================

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

    // Construir URL de S3 si existe foto
    const fotoPerfilUrl = datosUsuario.foto_perfil_url 
      ? construirUrlS3(datosUsuario.foto_perfil_url, 'perfil')
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
 * @body    { usuarios_ids: [1, 2, 3, ...] }
 */
router.post('/usuarios/fotos-batch', async (req, res) => {
  let connection;
  try {
    const { usuarios_ids } = req.body;

    if (!Array.isArray(usuarios_ids) || usuarios_ids.length === 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere un array de IDs de usuarios'
      });
    }

    // Limitar a 50 usuarios por petición para evitar sobrecarga
    const idsLimitados = usuarios_ids.slice(0, 50);

    console.log('📸 Obteniendo fotos de', idsLimitados.length, 'usuarios');

    connection = await db.getConnection();

    // Crear placeholders para la consulta (?, ?, ?, ...)
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

    console.log('✅ Fotos obtenidas:', usuarios.length);

    // Construir respuesta con URLs de S3
    const resultado = usuarios.map(u => ({
      id: u.id,
      nombre_completo: u.nombre_completo,
      nombre_usuario: u.nombre_usuario,
      foto_perfil_url: u.foto_perfil_url 
        ? construirUrlS3(u.foto_perfil_url, 'perfil')
        : null
    }));

    res.json({
      success: true,
      data: resultado
    });

  } catch (error) {
    console.error('❌ Error al obtener fotos de usuarios:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener fotos de usuarios',
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// =============================================================================
// 🔥 ENDPOINTS PROTEGIDOS (requieren autenticación)
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
    console.log('📸 Obteniendo fotos del usuario:', usuario_id);
    console.log('🔑 Datos del token:', req.usuario);
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
        url: construirUrlS3(datosUsuario.foto_perfil_url, 'perfil'),
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
        url: construirUrlS3(datosUsuario.foto_portada_url, 'portada'),
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
    // 4. OBTENER FOTOS DE PUBLICACIONES
    // =============================================
    const [publicacionesConFotos] = await connection.execute(
      `SELECT 
        id,
        imagen_s3 as url,
        contenido as descripcion,
        fecha_creacion as fecha
       FROM publicaciones
       WHERE usuario_id = ? 
       AND imagen_s3 IS NOT NULL
       AND imagen_s3 != ''
       AND oculto = 0
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
      url: construirUrlS3(p.url, 'publicacion'),
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

// =============================================================================
// EXPORTAR ROUTER
// =============================================================================
module.exports = router;