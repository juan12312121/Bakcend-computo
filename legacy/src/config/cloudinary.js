const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
const cloudinaryUrl = (process.env.CLOUDINARY_URL || '').trim();

if (cloudinaryUrl) {
  cloudinary.config({
    cloudinary_url: cloudinaryUrl
  });
} else {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
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
