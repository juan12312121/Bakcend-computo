-- Migration for Group Invitations
-- Run this in your MySQL database

CREATE TABLE IF NOT EXISTS `grupo_invitaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grupo_id` int NOT NULL,
  `remitente_id` int NOT NULL,
  `invitado_id` int NOT NULL,
  `estado` enum('pendiente', 'aceptada', 'rechazada') DEFAULT 'pendiente',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `grupo_id` (`grupo_id`),
  KEY `remitente_id` (`remitente_id`),
  KEY `invitado_id` (`invitado_id`),
  CONSTRAINT `grupo_invitaciones_ibfk_1` FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `grupo_invitaciones_ibfk_2` FOREIGN KEY (`remitente_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `grupo_invitaciones_ibfk_3` FOREIGN KEY (`invitado_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
