const { body } = require('express-validator');

exports.validarRegistro = [
  body('nombre_usuario')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('El nombre de usuario debe tener entre 3 y 50 caracteres')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('El nombre de usuario solo puede contener letras, números y guiones bajos'),
  
  body('email')
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  
  body('nombre_completo')
    .trim()
    .isLength({ min: 3, max: 150 })
    .withMessage('El nombre completo debe tener entre 3 y 150 caracteres'),
  
  body('contrasena')
    .isLength({ min: 6 })
    .withMessage('La contraseña debe tener al menos 6 caracteres')
];

exports.validarLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Email inválido')
    .normalizeEmail(),
  
  body('contrasena')
    .notEmpty()
    .withMessage('La contraseña es requerida')
];

exports.validarActualizarPerfil = [
  body('nombre_completo')
    .optional()
    .trim()
    .isLength({ min: 3, max: 150 })
    .withMessage('El nombre completo debe tener entre 3 y 150 caracteres'),
  
  body('biografia')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('La biografía no puede exceder 500 caracteres'),
  
  body('ubicacion')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('La ubicación no puede exceder 100 caracteres'),
  
  body('carrera')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('La carrera no puede exceder 100 caracteres')
];
