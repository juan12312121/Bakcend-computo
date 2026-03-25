const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ Usar rutas ABSOLUTAS basadas en la ubicación de server.js
const uploadsBase = path.join(__dirname, '../uploads');

// ✅ Crear carpetas si no existen
const crearCarpetas = () => {
  const carpetas = [
    path.join(uploadsBase, 'perfiles'),
    path.join(uploadsBase, 'portadas'),
    path.join(uploadsBase, 'publicaciones')
  ];

  carpetas.forEach(carpeta => {
    if (!fs.existsSync(carpeta)) {
      fs.mkdirSync(carpeta, { recursive: true });
      console.log(`✅ Carpeta creada: ${carpeta}`);
    } else {
      console.log(`📁 Carpeta ya existe: ${carpeta}`);
    }
  });
};

// Ejecutar creación de carpetas al iniciar
crearCarpetas();

// Configuración de almacenamiento
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let destino;
    
    // Determinar carpeta según el tipo de imagen
    if (file.fieldname === 'foto_perfil') {
      destino = path.join(uploadsBase, 'perfiles');
    } else if (file.fieldname === 'foto_portada') {
      destino = path.join(uploadsBase, 'portadas');
    } else {
      destino = path.join(uploadsBase, 'publicaciones');
    }
    
    console.log(`📤 Guardando ${file.fieldname} en: ${destino}`);
    cb(null, destino);
  },
  filename: function (req, file, cb) {
    // 🔥 CLAVE: Obtener el usuario_id desde req.usuario (viene del middleware proteger)
    const usuario_id = req.usuario ? req.usuario.id : 'guest';
    
    // Generar nombre único: foto_{tipo}-{usuario_id}-{timestamp}.ext
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Formato: foto_perfil-6-1761972628605.jpg
    const filename = `${file.fieldname}-${usuario_id}-${timestamp}${ext}`;
    
    console.log(`📝 Nombre de archivo generado: ${filename}`);
    console.log(`👤 Usuario ID: ${usuario_id}`);
    
    cb(null, filename);
  }
});

// Filtro de archivos (solo imágenes)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    console.log(`✅ Archivo válido: ${file.originalname}`);
    return cb(null, true);
  } else {
    console.log(`❌ Archivo rechazado: ${file.originalname}`);
    cb(new Error('Solo se permiten imágenes (jpeg, jpg, png, gif, webp)'));
  }
};

// Configuración de multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB máximo
  },
  fileFilter: fileFilter
});

module.exports = { upload };