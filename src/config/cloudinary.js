const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

if (process.env.CLOUDINARY_URL) {
  // Cloudinary detecta automáticamente la variable CLOUDINARY_URL
  console.log('✅ Usando CLOUDINARY_URL para la configuración');
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folder = 'trino/otros';
    if (file.fieldname === 'foto_perfil') folder = 'trino/perfiles';
    else if (file.fieldname === 'foto_portada') folder = 'trino/portadas';
    else if (file.fieldname === 'imagen') folder = 'trino/publicaciones';
    else if (file.fieldname === 'documentos') folder = 'trino/documentos';

    return {
      folder: folder,
      public_id: `${file.fieldname}-${Date.now()}`,
      resource_type: 'auto'
    };
  },
});

module.exports = {
  cloudinary,
  storage
};
