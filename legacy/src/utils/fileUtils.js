const fs = require('fs').promises;
const path = require('path');

/**
 * Elimina un archivo local de forma segura.
 * @param {string} filePath - Ruta completa o relativa (desde la raíz de src) del archivo.
 */
const deleteLocalFile = async (filePath) => {
    try {
        if (!filePath) return;

        let fullPath = filePath;
        if (filePath.startsWith('/uploads/')) {
            // Asumimos que estamos en src/utils y uploads está en src/uploads
            fullPath = path.join(__dirname, '..', filePath);
        }

        await fs.unlink(fullPath);
        console.log(`🗑️ Archivo eliminado: ${fullPath}`);
        return true;
    } catch (error) {
        console.error(`❌ Error al eliminar archivo ${filePath}:`, error.message);
        return false;
    }
};

/**
 * Genera la URL relativa para guardar en BD a partir de la ruta absoluta de Multer.
 * @param {string} absolutePath - Ruta absoluta devuelta por req.file.path.
 * @returns {string} - URL relativa (ej: /uploads/publicaciones/archivo.jpg).
 */
const getRelativeUrl = (absolutePath) => {
    if (!absolutePath) return null;
    const relativePath = path.relative(path.join(__dirname, '..'), absolutePath).replace(/\\/g, '/');
    return `/${relativePath}`;
};

module.exports = {
    deleteLocalFile,
    getRelativeUrl
};
