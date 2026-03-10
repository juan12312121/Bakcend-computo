const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { successResponse, errorResponse } = require('../utils/responses');

// Registrar nuevo usuario (solo campos esenciales)
exports.registro = async (req, res) => {
  try {
    const { nombre_usuario, email, nombre_completo, contrasena } = req.body;
    
    // Validar que todos los campos requeridos estén presentes
    if (!nombre_usuario || !email || !nombre_completo || !contrasena) {
      return errorResponse(res, 'Todos los campos son requeridos', 400);
    }
    
    // Verificar si el email ya existe
    const emailExiste = await Usuario.buscarPorEmail(email);
    if (emailExiste) {
      return errorResponse(res, 'El email ya está registrado', 400);
    }
    
    // Verificar si el nombre de usuario ya existe
    const usuarioExiste = await Usuario.buscarPorNombreUsuario(nombre_usuario);
    if (usuarioExiste) {
      return errorResponse(res, 'El nombre de usuario ya está en uso', 400);
    }
    
    // Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const contrasenaEncriptada = await bcrypt.hash(contrasena, salt);
    
    // Crear usuario (solo con campos esenciales)
    const usuarioId = await Usuario.crear({
      nombre_usuario,
      email,
      nombre_completo,
      contrasena: contrasenaEncriptada
    });
    
    // Obtener usuario creado
    const usuario = await Usuario.buscarPorId(usuarioId);
    
    // Generar token JWT
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    return successResponse(res, {
      usuario,
      token
    }, 'Usuario registrado exitosamente. Completa tu perfil desde la configuración.', 201);
    
  } catch (error) {
    console.error('Error en registro:', error);
    return errorResponse(res, 'Error al registrar usuario', 500);
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const { email, contrasena } = req.body;
    
    // Validar campos
    if (!email || !contrasena) {
      return errorResponse(res, 'Email y contraseña son requeridos', 400);
    }
    
    // Buscar usuario por email
    const usuario = await Usuario.buscarPorEmail(email);
    
    if (!usuario) {
      return errorResponse(res, 'Credenciales inválidas', 401);
    }
    
    // Verificar contraseña
    const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena);
    
    if (!contrasenaValida) {
      return errorResponse(res, 'Credenciales inválidas', 401);
    }
    
    // Verificar si la cuenta está activa
    if (!usuario.activo) {
      return errorResponse(res, 'Cuenta desactivada', 403);
    }
    
    // Generar token JWT
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    // Eliminar contraseña del objeto usuario
    delete usuario.contrasena;
    
    return successResponse(res, {
      usuario,
      token
    }, 'Login exitoso');
    
  } catch (error) {
    console.error('Error en login:', error);
    return errorResponse(res, 'Error al iniciar sesión', 500);
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    return successResponse(res, null, 'Sesión cerrada exitosamente');
  } catch (error) {
    console.error('Error en logout:', error);
    return errorResponse(res, 'Error al cerrar sesión', 500);
  }
};

// Verificar token
exports.verificarToken = async (req, res) => {
  try {
    const usuario = await Usuario.buscarPorId(req.usuario.id);
    
    if (!usuario) {
      return errorResponse(res, 'Usuario no encontrado', 404);
    }
    
    return successResponse(res, usuario, 'Token válido');
    
  } catch (error) {
    console.error('Error al verificar token:', error);
    return errorResponse(res, 'Error al verificar token', 500);
  }
};