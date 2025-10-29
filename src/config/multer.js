const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ SOLUCIÓN: Usar rutas ABSOLUTAS basadas en la ubicación de server.js
// __dirname aquí es: /home/ubuntu/Bakcend-computo/src/config
// Necesitamos subir a /home/ubuntu/Bakcend-computo/src/uploads

const uploadsBase = path.join(__dirname, '../uploads');

// ✅ Crear carpetas si no existen (CON RUTAS ABSOLUTAS)
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
    // Generar nombre único: timestamp-random.ext
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const filename = file.fieldname + '-' + uniqueSuffix + ext;
    
    console.log(`📝 Nombre de archivo: ${filename}`);
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
    fileSize: 5 * 1024 * 1024 // 5MB máximo
  },
  fileFilter: fileFilter
});

module.exports = upload;