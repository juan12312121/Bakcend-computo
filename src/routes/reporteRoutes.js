const express = require('express');
const { proteger } = require('../middlewares/auth');
const reporteController = require('../controllers/reporteController');

const router = express.Router();

// ==========================================
// REPORTES
// ==========================================
router.post('/crear', proteger, reporteController.crearReporte);
router.get('/publicacion/:publicacionId', proteger, reporteController.obtenerReportes);
router.get('/todos', proteger, reporteController.obtenerTodosReportes);
router.get('/estadisticas', proteger, reporteController.obtenerEstadisticasReportes);

// ==========================================
// PUBLICACIONES OCULTAS
// ==========================================
// Ocultar/mostrar publicaciones individuales
router.post('/ocultar', proteger, reporteController.ocultarPublicacion);
router.post('/mostrar', proteger, reporteController.mostrarPublicacion);
router.get('/ocultas', proteger, reporteController.obtenerPublicacionesOcultas);

// Publicaciones propias ocultas
router.post('/ocultar-propias', proteger, reporteController.ocultarTodasPropias);
router.post('/mostrar-propias', proteger, reporteController.mostrarTodasPropias);
router.get('/propias-ocultas', proteger, reporteController.obtenerPropiasOcultas);

// ==========================================
// NO ME INTERESA
// ==========================================
// Marcar/desmarcar publicaciones
router.post('/no-interesa', proteger, reporteController.marcarNoInteresa);
router.post('/si-interesa', proteger, reporteController.desmarcarNoInteresa);

// Consultar publicaciones y categorías marcadas
router.get('/no-interesan', proteger, reporteController.obtenerPublicacionesNoInteresan);
router.get('/categorias-no-interesan', proteger, reporteController.obtenerCategoriasNoInteresan);
router.get('/estadisticas-no-interesa', proteger, reporteController.obtenerEstadisticasNoInteresa);

// Limpiar marcas "No me interesa"
router.delete('/limpiar-no-interesa', proteger, reporteController.limpiarNoInteresa);
router.delete('/limpiar-categoria', proteger, reporteController.limpiarNoInteresaCategoria);

module.exports = router;