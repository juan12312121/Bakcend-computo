// src/routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { proteger } = require('../middlewares/auth');

// Todas las rutas de IA requieren estar autenticado
router.use(proteger);

/**
 * @route POST /api/ai/preguntar
 * @desc Ask the student AI assistant
 */
router.post('/preguntar', aiController.preguntarAsistente);

module.exports = router;
