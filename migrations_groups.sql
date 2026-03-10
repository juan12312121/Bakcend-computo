-- Migration for Groups Feature
-- Run this in your MySQL database

CREATE TABLE IF NOT EXISTS `grupos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text,
  `imagen_url` varchar(500) DEFAULT NULL,
  `imagen_portada_url` varchar(500) DEFAULT NULL,
  `creador_id` int NOT NULL,
  `privacidad` enum('publico', 'privado') DEFAULT 'publico',
  `req_aprobacion` tinyint(1) DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `creador_id` (`creador_id`),
  CONSTRAINT `grupos_ibfk_1` FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grupo_miembros` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grupo_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `rol` enum('miembro', 'admin', 'moderador') DEFAULT 'miembro',
  `estado` enum('pendiente', 'activo', 'rechazado') DEFAULT 'activo',
  `fecha_union` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_miembro` (`grupo_id`, `usuario_id`),
  KEY `grupo_id` (`grupo_id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `grupo_miembros_ibfk_1` FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `grupo_miembros_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add group context to publications
ALTER TABLE `publicaciones` ADD COLUMN `grupo_id` int DEFAULT NULL;
ALTER TABLE `publicaciones` ADD CONSTRAINT `fk_publicacion_grupo` FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE;
