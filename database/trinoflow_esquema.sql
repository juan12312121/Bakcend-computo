-- =====================================================================
-- TrinoFlow — esquema vacío de la base de datos para MySQL 8+
-- Generado a partir de los modelos Sequelize (src/infrastructure/database/models).
-- Solo estructura (89 tablas), sin datos.
--
-- Cómo usarlo:
--   mysql -u root -p < database/trinoflow_esquema.sql
-- o bien, con el .env configurado:  npm run db:init
--
-- ATENCIÓN: crea la base `redstudent_db` si no existe y BORRA Y VUELVE A CREAR sus tablas.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `redstudent_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `redstudent_db`;

SET NAMES utf8mb4;
SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;
SET @OLD_SQL_MODE = @@SQL_MODE;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------
-- 1. Borrar tablas anteriores
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `suspensiones`;
DROP TABLE IF EXISTS `palabras_prohibidas`;
DROP TABLE IF EXISTS `notas_moderacion`;
DROP TABLE IF EXISTS `acciones_moderacion`;
DROP TABLE IF EXISTS `reportes_contenido`;
DROP TABLE IF EXISTS `estadisticas_perfiles_diarias`;
DROP TABLE IF EXISTS `estadisticas_publicaciones_diarias`;
DROP TABLE IF EXISTS `estadisticas_eventos`;
DROP TABLE IF EXISTS `historias_destacadas_items`;
DROP TABLE IF EXISTS `historias_destacadas`;
DROP TABLE IF EXISTS `calificaciones_vendedor`;
DROP TABLE IF EXISTS `anuncio_reportes`;
DROP TABLE IF EXISTS `anuncio_interesados`;
DROP TABLE IF EXISTS `anuncio_visitas`;
DROP TABLE IF EXISTS `anuncio_guardados`;
DROP TABLE IF EXISTS `anuncio_fotos`;
DROP TABLE IF EXISTS `anuncios`;
DROP TABLE IF EXISTS `evento_staff`;
DROP TABLE IF EXISTS `boletos`;
DROP TABLE IF EXISTS `boleto_ordenes`;
DROP TABLE IF EXISTS `boleto_tipos`;
DROP TABLE IF EXISTS `tarifas_hora`;
DROP TABLE IF EXISTS `registros_horas`;
DROP TABLE IF EXISTS `calendario_tokens`;
DROP TABLE IF EXISTS `entregas`;
DROP TABLE IF EXISTS `asignaciones`;
DROP TABLE IF EXISTS `grupo_archivos`;
DROP TABLE IF EXISTS `grupo_carpetas`;
DROP TABLE IF EXISTS `documento_versiones`;
DROP TABLE IF EXISTS `documento_permisos`;
DROP TABLE IF EXISTS `documentos_colaborativos`;
DROP TABLE IF EXISTS `reacciones_mensajes_grupo`;
DROP TABLE IF EXISTS `reacciones_mensajes_chat`;
DROP TABLE IF EXISTS `canal_vistas`;
DROP TABLE IF EXISTS `canal_reacciones`;
DROP TABLE IF EXISTS `canal_publicaciones`;
DROP TABLE IF EXISTS `canal_miembros`;
DROP TABLE IF EXISTS `canales`;
DROP TABLE IF EXISTS `transmision_comentarios`;
DROP TABLE IF EXISTS `transmisiones`;
DROP TABLE IF EXISTS `llamada_participantes`;
DROP TABLE IF EXISTS `llamadas`;
DROP TABLE IF EXISTS `mensajes_grupo`;
DROP TABLE IF EXISTS `verificaciones_email`;
DROP TABLE IF EXISTS `bloqueos`;
DROP TABLE IF EXISTS `publicacion_hashtags`;
DROP TABLE IF EXISTS `hashtags`;
DROP TABLE IF EXISTS `encuesta_votos`;
DROP TABLE IF EXISTS `encuesta_opciones`;
DROP TABLE IF EXISTS `encuestas`;
DROP TABLE IF EXISTS `publicaciones_guardadas`;
DROP TABLE IF EXISTS `comentario_likes`;
DROP TABLE IF EXISTS `evento_asistentes`;
DROP TABLE IF EXISTS `eventos`;
DROP TABLE IF EXISTS `tarea_actividad`;
DROP TABLE IF EXISTS `tarea_checklist`;
DROP TABLE IF EXISTS `tarea_comentarios`;
DROP TABLE IF EXISTS `tarea_etiquetas`;
DROP TABLE IF EXISTS `etiquetas_tablero`;
DROP TABLE IF EXISTS `tarea_asignados`;
DROP TABLE IF EXISTS `tareas`;
DROP TABLE IF EXISTS `sprints`;
DROP TABLE IF EXISTS `tablero_columnas`;
DROP TABLE IF EXISTS `tablero_miembros`;
DROP TABLE IF EXISTS `tableros`;
DROP TABLE IF EXISTS `dispositivos`;
DROP TABLE IF EXISTS `restablecimientos_contrasena`;
DROP TABLE IF EXISTS `historias_vistas`;
DROP TABLE IF EXISTS `historias`;
DROP TABLE IF EXISTS `logs_seguridad`;
DROP TABLE IF EXISTS `mensajes_chat`;
DROP TABLE IF EXISTS `chats`;
DROP TABLE IF EXISTS `grupo_invitaciones`;
DROP TABLE IF EXISTS `grupo_miembros`;
DROP TABLE IF EXISTS `etiquetas`;
DROP TABLE IF EXISTS `documentos`;
DROP TABLE IF EXISTS `publicaciones_secciones`;
DROP TABLE IF EXISTS `secciones`;
DROP TABLE IF EXISTS `notificaciones`;
DROP TABLE IF EXISTS `seguidores`;
DROP TABLE IF EXISTS `compartidos`;
DROP TABLE IF EXISTS `publicaciones_no_interesa`;
DROP TABLE IF EXISTS `publicaciones_ocultas`;
DROP TABLE IF EXISTS `reportes`;
DROP TABLE IF EXISTS `likes`;
DROP TABLE IF EXISTS `comentarios`;
DROP TABLE IF EXISTS `publicaciones`;
DROP TABLE IF EXISTS `grupos`;
DROP TABLE IF EXISTS `usuarios`;

-- ---------------------------------------------------------------------
-- 2. Tablas (89)
-- ---------------------------------------------------------------------
-- Usuario
CREATE TABLE `usuarios` (`id` INTEGER auto_increment , `nombre_usuario` VARCHAR(50) NOT NULL UNIQUE, `email` VARCHAR(100) NOT NULL UNIQUE, `nombre_completo` VARCHAR(150) NOT NULL, `contrasena` VARCHAR(255) NOT NULL, `rol` ENUM('usuario', 'admin') NOT NULL DEFAULT 'usuario', `foto_perfil_url` VARCHAR(500), `foto_perfil_s3` VARCHAR(300), `foto_portada_url` VARCHAR(500), `foto_portada_s3` VARCHAR(300), `biografia` TEXT, `ubicacion` VARCHAR(100), `carrera` VARCHAR(100), `total_seguidores` INTEGER DEFAULT 0, `total_siguiendo` INTEGER DEFAULT 0, `total_posts` INTEGER DEFAULT 0, `mantener_sesion` TINYINT(1) DEFAULT false, `activo` TINYINT(1) DEFAULT true, `suspendido` TINYINT(1) DEFAULT false, `en_linea` TINYINT(1) DEFAULT false, `ultima_actividad` DATETIME, `intentos_fallidos` INTEGER DEFAULT 0, `bloqueo_hasta` DATETIME, `token_version` INTEGER NOT NULL DEFAULT 0, `cuenta_privada` TINYINT(1) NOT NULL DEFAULT false, `email_verificado` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Grupo
CREATE TABLE `grupos` (`id` INTEGER auto_increment , `nombre` VARCHAR(100) NOT NULL, `descripcion` TEXT, `imagen_url` VARCHAR(500), `imagen_portada_url` VARCHAR(500), `creador_id` INTEGER NOT NULL, `privacidad` ENUM('publico', 'privado') DEFAULT 'publico', `req_aprobacion` TINYINT(1) DEFAULT false, `tipo` ENUM('comunidad', 'escuela', 'trabajo', 'ocio', 'eventos') NOT NULL DEFAULT 'comunidad', `mensajes_temporales` ENUM('apagado', '24h', '7d') NOT NULL DEFAULT 'apagado', `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Publicacion
CREATE TABLE `publicaciones` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `grupo_id` INTEGER, `contenido` TEXT NOT NULL, `imagen_url` VARCHAR(500), `imagen_s3` VARCHAR(300), `video_url` VARCHAR(500), `video_s3` VARCHAR(300), `video_duracion` INTEGER, `total_vistas` INTEGER DEFAULT 0, `categoria` ENUM('General', 'Tecnología', 'Ciencias', 'Artes y Cultura', 'Deportes', 'Salud y Bienestar', 'Vida Universitaria', 'Opinión', 'Entrevistas', 'Trabajo', 'Negocios', 'Ocio', 'Eventos', 'Escuela') DEFAULT 'General', `color_categoria` VARCHAR(30) DEFAULT 'bg-orange-500', `visibilidad` ENUM('publico', 'seguidores', 'privado') NOT NULL DEFAULT 'publico', `total_likes` INTEGER DEFAULT 0, `total_dislikes` INTEGER DEFAULT 0, `total_comentarios` INTEGER DEFAULT 0, `total_compartidos` INTEGER DEFAULT 0, `oculto` TINYINT(1) DEFAULT false, `estado` ENUM('publicada', 'programada', 'borrador') NOT NULL DEFAULT 'publicada', `programada_para` DATETIME, `video_original_url` VARCHAR(500), `edicion` JSON, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `publicaciones` ADD INDEX `publicaciones_estado_programada_para` (`estado`, `programada_para`);

-- Comentario
CREATE TABLE `comentarios` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `texto` TEXT NOT NULL, `padre_id` INTEGER, `total_likes` INTEGER DEFAULT 0, `total_respuestas` INTEGER DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`padre_id`) REFERENCES `comentarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `comentarios` ADD INDEX `comentarios_publicacion_id_padre_id` (`publicacion_id`, `padre_id`);

-- Like
CREATE TABLE `likes` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `tipo` ENUM('me_gusta', 'me_encanta', 'jaja', 'asombro', 'triste', 'enojo', 'aplauso') NOT NULL DEFAULT 'me_gusta', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `likes` ADD UNIQUE INDEX `likes_publicacion_id_usuario_id` (`publicacion_id`, `usuario_id`);

-- Reporte
CREATE TABLE `reportes` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `motivo` ENUM('Acoso o bullying', 'Violencia o daño', 'Spam o publicidad', 'Información falsa', 'Suplantación de identidad', 'Lenguaje ofensivo', 'Otro') NOT NULL DEFAULT 'Otro', `descripcion` TEXT, `fecha_reporte` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `reportes` ADD UNIQUE INDEX `reportes_publicacion_id_usuario_id` (`publicacion_id`, `usuario_id`);

-- PublicacionOculta
CREATE TABLE `publicaciones_ocultas` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `publicacion_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `publicaciones_ocultas` ADD UNIQUE INDEX `publicaciones_ocultas_usuario_id_publicacion_id` (`usuario_id`, `publicacion_id`);

-- PublicacionNoInteresa
CREATE TABLE `publicaciones_no_interesa` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `publicacion_id` INTEGER NOT NULL, `categoria` VARCHAR(50), `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `publicaciones_no_interesa` ADD UNIQUE INDEX `publicaciones_no_interesa_usuario_id_publicacion_id` (`usuario_id`, `publicacion_id`);

-- Compartido
CREATE TABLE `compartidos` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `compartido_con_usuario_id` INTEGER, `plataforma` VARCHAR(50), `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seguidor
CREATE TABLE `seguidores` (`id` INTEGER auto_increment , `seguidor_id` INTEGER NOT NULL, `siguiendo_id` INTEGER NOT NULL, `estado` ENUM('aceptado', 'pendiente') NOT NULL DEFAULT 'aceptado', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`seguidor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`siguiendo_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `seguidores` ADD UNIQUE INDEX `seguidores_seguidor_id_siguiendo_id` (`seguidor_id`, `siguiendo_id`);

-- Notificacion
CREATE TABLE `notificaciones` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `de_usuario_id` INTEGER, `tipo` ENUM('like', 'comment', 'follow', 'share', 'invitacion_grupo', 'reaccion', 'respuesta_comentario', 'like_comentario', 'mencion', 'solicitud_seguimiento', 'seguimiento_aceptado', 'tarea_asignada', 'tarea_comentario', 'tarea_movida', 'tarea_vence', 'evento_invitacion', 'evento_recordatorio', 'evento_actualizado', 'evento_cancelado', 'llamada_perdida', 'transmision_en_vivo', 'canal_publicacion', 'documento_compartido', 'archivo_subido', 'asignacion_nueva', 'entrega_recibida', 'entrega_calificada', 'boleto_comprado', 'boleto_usado', 'anuncio_interes', 'anuncio_vendido', 'publicacion_programada', 'reporte_resuelto') NOT NULL, `publicacion_id` INTEGER, `mensaje` TEXT, `entidad_tipo` ENUM('publicacion', 'comentario', 'tablero', 'tarea', 'evento', 'grupo', 'usuario', 'transmision', 'canal', 'documento', 'archivo', 'asignacion', 'boleto', 'anuncio'), `entidad_id` INTEGER, `leida` TINYINT(1) DEFAULT false, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`de_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seccion
CREATE TABLE `secciones` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `nombre` VARCHAR(100) NOT NULL, `icono` VARCHAR(50) DEFAULT 'fa-folder', `color` VARCHAR(100) DEFAULT 'from-gray-400 to-gray-600', `imagen_portada` VARCHAR(500), `total_posts` INTEGER DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PublicacionSeccion
CREATE TABLE `publicaciones_secciones` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `seccion_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`seccion_id`) REFERENCES `secciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `publicaciones_secciones` ADD UNIQUE INDEX `publicaciones_secciones_publicacion_id_seccion_id` (`publicacion_id`, `seccion_id`);

-- Documento
CREATE TABLE `documentos` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `publicacion_id` INTEGER, `documento_url` VARCHAR(500), `documento_s3` VARCHAR(300) NOT NULL DEFAULT '', `nombre_archivo` VARCHAR(255) NOT NULL, `tamano_archivo` BIGINT NOT NULL, `tipo_archivo` VARCHAR(100) NOT NULL, `icono` ENUM('fa-file-pdf', 'fa-file-word', 'fa-file-excel', 'fa-file-powerpoint', 'fa-file-archive', 'fa-file-csv', 'fa-file-code', 'fa-file') DEFAULT 'fa-file', `color` VARCHAR(30) DEFAULT 'text-gray-500', `descripcion` TEXT, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Etiqueta
CREATE TABLE `etiquetas` (`id` INTEGER auto_increment , `nombre` VARCHAR(50) NOT NULL UNIQUE, `icono` VARCHAR(50) DEFAULT 'fa-tag', `color` VARCHAR(50) DEFAULT 'teal', `total_posts` INTEGER DEFAULT 0, `tendencia` TINYINT(1) DEFAULT false, `fecha_creacion` DATETIME, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- GrupoMiembro
CREATE TABLE `grupo_miembros` (`id` INTEGER auto_increment , `grupo_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `rol` ENUM('miembro', 'admin', 'moderador') DEFAULT 'miembro', `estado` ENUM('pendiente', 'activo', 'rechazado') DEFAULT 'activo', `ultimo_mensaje_leido_id` INTEGER, `fecha_union` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `grupo_miembros` ADD UNIQUE INDEX `grupo_miembros_grupo_id_usuario_id` (`grupo_id`, `usuario_id`);

-- GrupoInvitacion
CREATE TABLE `grupo_invitaciones` (`id` INTEGER auto_increment , `grupo_id` INTEGER NOT NULL, `remitente_id` INTEGER NOT NULL, `invitado_id` INTEGER NOT NULL, `estado` ENUM('pendiente', 'aceptada', 'rechazada') DEFAULT 'pendiente', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`remitente_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`invitado_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Chat
CREATE TABLE `chats` (`id` INTEGER auto_increment , `usuario1_id` INTEGER NOT NULL, `usuario2_id` INTEGER NOT NULL, `iniciador_id` INTEGER, `estado` ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending', `ultima_interaccion` DATETIME, `mensajes_temporales` ENUM('apagado', '24h', '7d') NOT NULL DEFAULT 'apagado', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario1_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario2_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `chats` ADD UNIQUE INDEX `chats_usuario1_id_usuario2_id` (`usuario1_id`, `usuario2_id`);

-- MensajeChat
CREATE TABLE `mensajes_chat` (`id` INTEGER auto_increment , `chat_id` INTEGER NOT NULL, `emisor_id` INTEGER NOT NULL, `texto` TEXT NOT NULL, `leido` TINYINT(1) DEFAULT false, `archivo_url` VARCHAR(500), `tipo_archivo` VARCHAR(20), `leido_en` DATETIME, `duracion_seg` INTEGER, `expira_en` DATETIME, `es_aviso` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`chat_id`) REFERENCES `chats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`emisor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- LogSeguridad
CREATE TABLE `logs_seguridad` (`id` INTEGER auto_increment , `usuario_id` INTEGER, `evento` VARCHAR(100) NOT NULL, `detalles` TEXT, `ip` VARCHAR(45), `user_agent` TEXT, `fecha_creacion` DATETIME, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Historia
CREATE TABLE `historias` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `tipo` ENUM('imagen', 'video', 'texto') NOT NULL, `media_url` VARCHAR(500), `media_s3` VARCHAR(255), `texto` VARCHAR(500), `fondo` VARCHAR(100), `duracion_seg` INTEGER NOT NULL DEFAULT 5, `total_vistas` INTEGER NOT NULL DEFAULT 0, `expira_en` DATETIME NOT NULL, `archivada` TINYINT(1) NOT NULL DEFAULT false, `media_original_url` VARCHAR(500), `edicion` JSON, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `historias` ADD INDEX `historias_usuario_id_expira_en` (`usuario_id`, `expira_en`);

-- HistoriaVista
CREATE TABLE `historias_vistas` (`id` INTEGER auto_increment , `historia_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`historia_id`) REFERENCES `historias` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `historias_vistas` ADD UNIQUE INDEX `historias_vistas_historia_id_usuario_id` (`historia_id`, `usuario_id`);

-- RestablecimientoContrasena
CREATE TABLE `restablecimientos_contrasena` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `token_hash` VARCHAR(64) NOT NULL UNIQUE, `expira_en` DATETIME NOT NULL, `usado_en` DATETIME DEFAULT NULL, `ip` VARCHAR(45), `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `restablecimientos_contrasena` ADD INDEX `restablecimientos_contrasena_usuario_id_fecha_creacion` (`usuario_id`, `fecha_creacion`);

-- Dispositivo
CREATE TABLE `dispositivos` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `token` VARCHAR(400) NOT NULL UNIQUE, `plataforma` ENUM('android', 'ios', 'web') NOT NULL DEFAULT 'android', `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `dispositivos` ADD INDEX `dispositivos_usuario_id` (`usuario_id`);

-- Tablero
CREATE TABLE `tableros` (`id` INTEGER auto_increment , `nombre` VARCHAR(100) NOT NULL, `descripcion` TEXT, `grupo_id` INTEGER, `creador_id` INTEGER NOT NULL, `clave` VARCHAR(10) NOT NULL, `color` VARCHAR(60) NOT NULL DEFAULT 'from-orange-400 to-orange-600', `contador_tareas` INTEGER NOT NULL DEFAULT 0, `archivado` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tableros` ADD INDEX `tableros_grupo_id` (`grupo_id`);

-- TableroMiembro
CREATE TABLE `tablero_miembros` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `rol` ENUM('admin', 'miembro', 'observador') NOT NULL DEFAULT 'miembro', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tablero_miembros` ADD UNIQUE INDEX `tablero_miembros_tablero_id_usuario_id` (`tablero_id`, `usuario_id`);

-- TableroColumna
CREATE TABLE `tablero_columnas` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `nombre` VARCHAR(60) NOT NULL, `posicion` INTEGER NOT NULL DEFAULT 0, `limite_wip` INTEGER, `es_final` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tablero_columnas` ADD INDEX `tablero_columnas_tablero_id_posicion` (`tablero_id`, `posicion`);

-- Sprint
CREATE TABLE `sprints` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `nombre` VARCHAR(80) NOT NULL, `objetivo` TEXT, `inicio` DATETIME, `fin` DATETIME, `estado` ENUM('planeado', 'activo', 'cerrado') NOT NULL DEFAULT 'planeado', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `sprints` ADD INDEX `sprints_tablero_id_estado` (`tablero_id`, `estado`);

-- Tarea
CREATE TABLE `tareas` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `columna_id` INTEGER NOT NULL, `sprint_id` INTEGER, `numero` INTEGER NOT NULL, `titulo` VARCHAR(200) NOT NULL, `descripcion` TEXT, `tipo` ENUM('tarea', 'historia', 'bug', 'epica') NOT NULL DEFAULT 'tarea', `prioridad` ENUM('baja', 'media', 'alta', 'urgente') NOT NULL DEFAULT 'media', `puntos` INTEGER, `fecha_limite` DATETIME, `posicion` DOUBLE PRECISION NOT NULL DEFAULT 0, `creador_id` INTEGER NOT NULL, `epica_id` INTEGER, `completada_en` DATETIME, `recordatorio_enviado` TINYINT(1) NOT NULL DEFAULT false, `archivada` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`columna_id`) REFERENCES `tablero_columnas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`sprint_id`) REFERENCES `sprints` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`epica_id`) REFERENCES `tareas` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tareas` ADD UNIQUE INDEX `tareas_tablero_id_numero` (`tablero_id`, `numero`);
ALTER TABLE `tareas` ADD INDEX `tareas_columna_id_posicion` (`columna_id`, `posicion`);
ALTER TABLE `tareas` ADD INDEX `tareas_sprint_id` (`sprint_id`);

-- TareaAsignado
CREATE TABLE `tarea_asignados` (`id` INTEGER auto_increment , `tarea_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tarea_id`) REFERENCES `tareas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tarea_asignados` ADD UNIQUE INDEX `tarea_asignados_tarea_id_usuario_id` (`tarea_id`, `usuario_id`);

-- EtiquetaTablero
CREATE TABLE `etiquetas_tablero` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `nombre` VARCHAR(40) NOT NULL, `color` VARCHAR(30) NOT NULL DEFAULT 'bg-gray-500', PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `etiquetas_tablero` ADD UNIQUE INDEX `etiquetas_tablero_tablero_id_nombre` (`tablero_id`, `nombre`);

-- TareaEtiqueta
CREATE TABLE `tarea_etiquetas` (`id` INTEGER auto_increment , `tarea_id` INTEGER NOT NULL, `etiqueta_id` INTEGER NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`tarea_id`) REFERENCES `tareas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`etiqueta_id`) REFERENCES `etiquetas_tablero` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tarea_etiquetas` ADD UNIQUE INDEX `tarea_etiquetas_tarea_id_etiqueta_id` (`tarea_id`, `etiqueta_id`);

-- TareaComentario
CREATE TABLE `tarea_comentarios` (`id` INTEGER auto_increment , `tarea_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `texto` TEXT NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tarea_id`) REFERENCES `tareas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tarea_comentarios` ADD INDEX `tarea_comentarios_tarea_id` (`tarea_id`);

-- TareaChecklist
CREATE TABLE `tarea_checklist` (`id` INTEGER auto_increment , `tarea_id` INTEGER NOT NULL, `texto` VARCHAR(300) NOT NULL, `hecho` TINYINT(1) NOT NULL DEFAULT false, `posicion` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (`id`), FOREIGN KEY (`tarea_id`) REFERENCES `tareas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tarea_checklist` ADD INDEX `tarea_checklist_tarea_id` (`tarea_id`);

-- TareaActividad
CREATE TABLE `tarea_actividad` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `tarea_id` INTEGER, `usuario_id` INTEGER NOT NULL, `accion` VARCHAR(30) NOT NULL, `detalle` TEXT, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tarea_actividad` ADD INDEX `tarea_actividad_tablero_id_fecha_creacion` (`tablero_id`, `fecha_creacion`);
ALTER TABLE `tarea_actividad` ADD INDEX `tarea_actividad_tarea_id` (`tarea_id`);

-- Evento
CREATE TABLE `eventos` (`id` INTEGER auto_increment , `creador_id` INTEGER NOT NULL, `grupo_id` INTEGER, `titulo` VARCHAR(150) NOT NULL, `descripcion` TEXT, `modalidad` ENUM('presencial', 'en_linea', 'hibrido') NOT NULL DEFAULT 'presencial', `categoria` ENUM('social', 'trabajo', 'escuela', 'deporte', 'cultura', 'tecnologia', 'otro') NOT NULL DEFAULT 'social', `visibilidad` ENUM('publico', 'seguidores', 'grupo', 'privado') NOT NULL DEFAULT 'publico', `lugar` VARCHAR(200), `enlace` VARCHAR(500), `inicio` DATETIME NOT NULL, `fin` DATETIME, `portada_url` VARCHAR(500), `portada_s3` VARCHAR(300), `cupo` INTEGER, `total_asistentes` INTEGER NOT NULL DEFAULT 0, `total_interesados` INTEGER NOT NULL DEFAULT 0, `cancelado` TINYINT(1) NOT NULL DEFAULT false, `recordatorio_enviado` TINYINT(1) NOT NULL DEFAULT false, `requiere_boleto` TINYINT(1) NOT NULL DEFAULT false, `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN', `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `eventos` ADD INDEX `eventos_inicio` (`inicio`);
ALTER TABLE `eventos` ADD INDEX `eventos_grupo_id` (`grupo_id`);
ALTER TABLE `eventos` ADD INDEX `eventos_creador_id` (`creador_id`);

-- EventoAsistente
CREATE TABLE `evento_asistentes` (`id` INTEGER auto_increment , `evento_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `estado` ENUM('voy', 'interesado', 'no_voy', 'invitado') NOT NULL DEFAULT 'voy', `invitado_por` INTEGER, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `evento_asistentes` ADD UNIQUE INDEX `evento_asistentes_evento_id_usuario_id` (`evento_id`, `usuario_id`);

-- ComentarioLike
CREATE TABLE `comentario_likes` (`id` INTEGER auto_increment , `comentario_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`comentario_id`) REFERENCES `comentarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `comentario_likes` ADD UNIQUE INDEX `comentario_likes_comentario_id_usuario_id` (`comentario_id`, `usuario_id`);

-- PublicacionGuardada
CREATE TABLE `publicaciones_guardadas` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `publicacion_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `publicaciones_guardadas` ADD UNIQUE INDEX `publicaciones_guardadas_usuario_id_publicacion_id` (`usuario_id`, `publicacion_id`);

-- Encuesta
CREATE TABLE `encuestas` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL UNIQUE, `multiple` TINYINT(1) NOT NULL DEFAULT false, `cierra_en` DATETIME, `total_votos` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- EncuestaOpcion
CREATE TABLE `encuesta_opciones` (`id` INTEGER auto_increment , `encuesta_id` INTEGER NOT NULL, `texto` VARCHAR(120) NOT NULL, `posicion` INTEGER NOT NULL DEFAULT 0, `total_votos` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (`id`), FOREIGN KEY (`encuesta_id`) REFERENCES `encuestas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `encuesta_opciones` ADD INDEX `encuesta_opciones_encuesta_id` (`encuesta_id`);

-- EncuestaVoto
CREATE TABLE `encuesta_votos` (`id` INTEGER auto_increment , `encuesta_id` INTEGER NOT NULL, `opcion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`encuesta_id`) REFERENCES `encuestas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`opcion_id`) REFERENCES `encuesta_opciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `encuesta_votos` ADD UNIQUE INDEX `encuesta_votos_opcion_id_usuario_id` (`opcion_id`, `usuario_id`);
ALTER TABLE `encuesta_votos` ADD INDEX `encuesta_votos_encuesta_id_usuario_id` (`encuesta_id`, `usuario_id`);

-- Hashtag
CREATE TABLE `hashtags` (`id` INTEGER auto_increment , `nombre` VARCHAR(80) NOT NULL UNIQUE, `total_publicaciones` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PublicacionHashtag
CREATE TABLE `publicacion_hashtags` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `hashtag_id` INTEGER NOT NULL, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`hashtag_id`) REFERENCES `hashtags` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `publicacion_hashtags` ADD UNIQUE INDEX `publicacion_hashtags_publicacion_id_hashtag_id` (`publicacion_id`, `hashtag_id`);
ALTER TABLE `publicacion_hashtags` ADD INDEX `publicacion_hashtags_hashtag_id` (`hashtag_id`);

-- Bloqueo
CREATE TABLE `bloqueos` (`id` INTEGER auto_increment , `bloqueador_id` INTEGER NOT NULL, `bloqueado_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`bloqueador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`bloqueado_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `bloqueos` ADD UNIQUE INDEX `bloqueos_bloqueador_id_bloqueado_id` (`bloqueador_id`, `bloqueado_id`);
ALTER TABLE `bloqueos` ADD INDEX `bloqueos_bloqueado_id` (`bloqueado_id`);

-- VerificacionEmail
CREATE TABLE `verificaciones_email` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `token_hash` VARCHAR(64) NOT NULL UNIQUE, `expira_en` DATETIME NOT NULL, `usado_en` DATETIME DEFAULT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `verificaciones_email` ADD INDEX `verificaciones_email_usuario_id` (`usuario_id`);

-- MensajeGrupo
CREATE TABLE `mensajes_grupo` (`id` INTEGER auto_increment , `grupo_id` INTEGER NOT NULL, `emisor_id` INTEGER NOT NULL, `texto` TEXT NOT NULL, `archivo_url` VARCHAR(500), `tipo_archivo` VARCHAR(20), `duracion_seg` INTEGER, `expira_en` DATETIME, `es_aviso` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`emisor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `mensajes_grupo` ADD INDEX `mensajes_grupo_grupo_id_id` (`grupo_id`, `id`);

-- Llamada
CREATE TABLE `llamadas` (`id` INTEGER auto_increment , `iniciador_id` INTEGER NOT NULL, `destinatario_id` INTEGER, `grupo_id` INTEGER, `tipo` ENUM('audio', 'video') NOT NULL DEFAULT 'audio', `estado` ENUM('sonando', 'en_curso', 'terminada', 'perdida', 'rechazada') NOT NULL DEFAULT 'sonando', `inicio` DATETIME, `fin` DATETIME, `duracion_seg` INTEGER NOT NULL DEFAULT 0, `max_participantes` INTEGER NOT NULL DEFAULT 1, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`iniciador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`destinatario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `llamadas` ADD INDEX `llamadas_iniciador_id` (`iniciador_id`);
ALTER TABLE `llamadas` ADD INDEX `llamadas_destinatario_id` (`destinatario_id`);
ALTER TABLE `llamadas` ADD INDEX `llamadas_grupo_id` (`grupo_id`);
ALTER TABLE `llamadas` ADD INDEX `llamadas_estado` (`estado`);

-- LlamadaParticipante
CREATE TABLE `llamada_participantes` (`id` INTEGER auto_increment , `llamada_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `estado` ENUM('invitado', 'unido', 'salio', 'rechazo', 'perdida') NOT NULL DEFAULT 'invitado', `unido_en` DATETIME, `salio_en` DATETIME, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`llamada_id`) REFERENCES `llamadas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `llamada_participantes` ADD UNIQUE INDEX `llamada_participantes_llamada_id_usuario_id` (`llamada_id`, `usuario_id`);
ALTER TABLE `llamada_participantes` ADD INDEX `llamada_participantes_usuario_id` (`usuario_id`);

-- Transmision
CREATE TABLE `transmisiones` (`id` INTEGER auto_increment , `anfitrion_id` INTEGER NOT NULL, `titulo` VARCHAR(150) NOT NULL, `grupo_id` INTEGER, `estado` ENUM('en_vivo', 'terminada') NOT NULL DEFAULT 'en_vivo', `inicio` DATETIME NOT NULL, `fin` DATETIME, `max_espectadores` INTEGER NOT NULL DEFAULT 0, `total_espectadores` INTEGER NOT NULL DEFAULT 0, `total_comentarios` INTEGER NOT NULL DEFAULT 0, `total_reacciones` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`anfitrion_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `transmisiones` ADD INDEX `transmisiones_anfitrion_id` (`anfitrion_id`);
ALTER TABLE `transmisiones` ADD INDEX `transmisiones_grupo_id` (`grupo_id`);
ALTER TABLE `transmisiones` ADD INDEX `transmisiones_estado` (`estado`);

-- TransmisionComentario
CREATE TABLE `transmision_comentarios` (`id` INTEGER auto_increment , `transmision_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `texto` VARCHAR(300) NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`transmision_id`) REFERENCES `transmisiones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `transmision_comentarios` ADD INDEX `transmision_comentarios_transmision_id_id` (`transmision_id`, `id`);

-- Canal
CREATE TABLE `canales` (`id` INTEGER auto_increment , `creador_id` INTEGER NOT NULL, `nombre` VARCHAR(100) NOT NULL, `descripcion` TEXT, `foto_url` VARCHAR(500), `privacidad` ENUM('publico', 'privado') NOT NULL DEFAULT 'publico', `codigo_invitacion` VARCHAR(40) NOT NULL UNIQUE, `total_suscriptores` INTEGER NOT NULL DEFAULT 0, `total_publicaciones` INTEGER NOT NULL DEFAULT 0, `ultima_publicacion_en` DATETIME, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `canales` ADD INDEX `canales_privacidad_total_suscriptores` (`privacidad`, `total_suscriptores`);
ALTER TABLE `canales` ADD INDEX `canales_creador_id` (`creador_id`);

-- CanalMiembro
CREATE TABLE `canal_miembros` (`id` INTEGER auto_increment , `canal_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `rol` ENUM('propietario', 'admin', 'suscriptor') NOT NULL DEFAULT 'suscriptor', `silenciado` TINYINT(1) NOT NULL DEFAULT false, `ultima_leida_id` INTEGER, `fecha_union` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`canal_id`) REFERENCES `canales` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `canal_miembros` ADD UNIQUE INDEX `canal_miembros_canal_id_usuario_id` (`canal_id`, `usuario_id`);
ALTER TABLE `canal_miembros` ADD INDEX `canal_miembros_usuario_id` (`usuario_id`);

-- CanalPublicacion
CREATE TABLE `canal_publicaciones` (`id` INTEGER auto_increment , `canal_id` INTEGER NOT NULL, `autor_id` INTEGER NOT NULL, `texto` TEXT NOT NULL, `archivo_url` VARCHAR(500), `tipo_archivo` VARCHAR(20), `nombre_archivo` VARCHAR(255), `total_vistas` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`canal_id`) REFERENCES `canales` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`autor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `canal_publicaciones` ADD INDEX `canal_publicaciones_canal_id_id` (`canal_id`, `id`);

-- CanalReaccion
CREATE TABLE `canal_reacciones` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `emoji` VARCHAR(16) NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `canal_publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `canal_reacciones` ADD UNIQUE INDEX `canal_reacciones_publicacion_id_usuario_id` (`publicacion_id`, `usuario_id`);

-- CanalVista
CREATE TABLE `canal_vistas` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `canal_publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `canal_vistas` ADD UNIQUE INDEX `canal_vistas_publicacion_id_usuario_id` (`publicacion_id`, `usuario_id`);

-- ReaccionMensajeChat
CREATE TABLE `reacciones_mensajes_chat` (`id` INTEGER auto_increment , `mensaje_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `emoji` VARCHAR(16) NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`mensaje_id`) REFERENCES `mensajes_chat` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `reacciones_mensajes_chat` ADD UNIQUE INDEX `reacciones_mensajes_chat_mensaje_id_usuario_id` (`mensaje_id`, `usuario_id`);

-- ReaccionMensajeGrupo
CREATE TABLE `reacciones_mensajes_grupo` (`id` INTEGER auto_increment , `mensaje_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `emoji` VARCHAR(16) NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`mensaje_id`) REFERENCES `mensajes_grupo` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `reacciones_mensajes_grupo` ADD UNIQUE INDEX `reacciones_mensajes_grupo_mensaje_id_usuario_id` (`mensaje_id`, `usuario_id`);

-- DocumentoColaborativo
CREATE TABLE `documentos_colaborativos` (`id` INTEGER auto_increment , `titulo` VARCHAR(200) NOT NULL, `grupo_id` INTEGER, `propietario_id` INTEGER NOT NULL, `estado_yjs` LONGBLOB, `texto_plano` MEDIUMTEXT NOT NULL, `resumen` VARCHAR(300) NOT NULL DEFAULT '', `en_papelera` TINYINT(1) NOT NULL DEFAULT false, `fecha_papelera` DATETIME, `ultimo_editor_id` INTEGER, `fecha_edicion` DATETIME, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`propietario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`ultimo_editor_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `documentos_colaborativos` ADD INDEX `documentos_colaborativos_grupo_id_en_papelera` (`grupo_id`, `en_papelera`);
ALTER TABLE `documentos_colaborativos` ADD INDEX `documentos_colaborativos_propietario_id_en_papelera` (`propietario_id`, `en_papelera`);

-- DocumentoPermiso
CREATE TABLE `documento_permisos` (`id` INTEGER auto_increment , `documento_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `permiso` ENUM('ver', 'editar') NOT NULL DEFAULT 'ver', `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`documento_id`) REFERENCES `documentos_colaborativos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `documento_permisos` ADD UNIQUE INDEX `documento_permisos_documento_id_usuario_id` (`documento_id`, `usuario_id`);
ALTER TABLE `documento_permisos` ADD INDEX `documento_permisos_usuario_id` (`usuario_id`);

-- DocumentoVersion
CREATE TABLE `documento_versiones` (`id` INTEGER auto_increment , `documento_id` INTEGER NOT NULL, `autor_id` INTEGER, `tipo` ENUM('manual', 'automatica') NOT NULL DEFAULT 'manual', `nombre` VARCHAR(120), `estado_yjs` LONGBLOB NOT NULL, `texto_plano` MEDIUMTEXT NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`documento_id`) REFERENCES `documentos_colaborativos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`autor_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `documento_versiones` ADD INDEX `documento_versiones_documento_id_fecha_creacion` (`documento_id`, `fecha_creacion`);

-- CarpetaGrupo
CREATE TABLE `grupo_carpetas` (`id` INTEGER auto_increment , `grupo_id` INTEGER NOT NULL, `padre_id` INTEGER, `nombre` VARCHAR(120) NOT NULL, `creador_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`padre_id`) REFERENCES `grupo_carpetas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `grupo_carpetas` ADD INDEX `grupo_carpetas_grupo_id_padre_id` (`grupo_id`, `padre_id`);

-- ArchivoGrupo
CREATE TABLE `grupo_archivos` (`id` INTEGER auto_increment , `grupo_id` INTEGER NOT NULL, `carpeta_id` INTEGER, `usuario_id` INTEGER NOT NULL, `nombre` VARCHAR(255) NOT NULL, `url` VARCHAR(500) NOT NULL, `storage_id` VARCHAR(300), `mimetype` VARCHAR(120) NOT NULL, `tipo` ENUM('imagen', 'documento', 'audio', 'video', 'otro') NOT NULL DEFAULT 'otro', `tamano` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`carpeta_id`) REFERENCES `grupo_carpetas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `grupo_archivos` ADD INDEX `grupo_archivos_grupo_id_carpeta_id` (`grupo_id`, `carpeta_id`);
ALTER TABLE `grupo_archivos` ADD INDEX `grupo_archivos_usuario_id` (`usuario_id`);

-- Asignacion
CREATE TABLE `asignaciones` (`id` INTEGER auto_increment , `grupo_id` INTEGER NOT NULL, `creador_id` INTEGER NOT NULL, `titulo` VARCHAR(200) NOT NULL, `instrucciones` TEXT, `archivo_url` VARCHAR(500), `archivo_id` VARCHAR(300), `archivo_nombre` VARCHAR(255), `archivo_tipo` VARCHAR(120), `fecha_entrega` DATETIME NOT NULL, `puntos_maximos` INTEGER NOT NULL DEFAULT 100, `acepta_tardias` TINYINT(1) NOT NULL DEFAULT true, `recordatorio_enviado` TINYINT(1) NOT NULL DEFAULT false, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`creador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `asignaciones` ADD INDEX `asignaciones_grupo_id_fecha_entrega` (`grupo_id`, `fecha_entrega`);
ALTER TABLE `asignaciones` ADD INDEX `asignaciones_fecha_entrega` (`fecha_entrega`);

-- Entrega
CREATE TABLE `entregas` (`id` INTEGER auto_increment , `asignacion_id` INTEGER NOT NULL, `alumno_id` INTEGER NOT NULL, `estado` ENUM('entregada', 'tarde', 'calificada', 'devuelta') NOT NULL DEFAULT 'entregada', `comentario` TEXT, `archivo_url` VARCHAR(500), `archivo_id` VARCHAR(300), `archivo_nombre` VARCHAR(255), `archivo_tipo` VARCHAR(120), `entregada_en` DATETIME, `fue_tarde` TINYINT(1) NOT NULL DEFAULT false, `intentos` INTEGER NOT NULL DEFAULT 1, `puntos` DOUBLE PRECISION, `retroalimentacion` TEXT, `calificada_en` DATETIME, `calificada_por` INTEGER, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`asignacion_id`) REFERENCES `asignaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`alumno_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `entregas` ADD UNIQUE INDEX `entregas_asignacion_id_alumno_id` (`asignacion_id`, `alumno_id`);
ALTER TABLE `entregas` ADD INDEX `entregas_alumno_id` (`alumno_id`);

-- CalendarioToken
CREATE TABLE `calendario_tokens` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL UNIQUE, `token` VARCHAR(64) NOT NULL UNIQUE, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- RegistroHoras
CREATE TABLE `registros_horas` (`id` INTEGER auto_increment , `tarea_id` INTEGER NOT NULL, `tablero_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `inicio` DATETIME NOT NULL, `fin` DATETIME, `minutos` INTEGER NOT NULL DEFAULT 0, `nota` VARCHAR(500), `facturable` TINYINT(1) NOT NULL DEFAULT true, `cronometro_de` INTEGER UNIQUE, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tarea_id`) REFERENCES `tareas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `registros_horas` ADD INDEX `registros_horas_tarea_id` (`tarea_id`);
ALTER TABLE `registros_horas` ADD INDEX `registros_horas_tablero_id_inicio` (`tablero_id`, `inicio`);
ALTER TABLE `registros_horas` ADD INDEX `registros_horas_usuario_id_inicio` (`usuario_id`, `inicio`);

-- TarifaHora
CREATE TABLE `tarifas_hora` (`id` INTEGER auto_increment , `tablero_id` INTEGER NOT NULL, `usuario_id` INTEGER, `tarifa_centavos` INTEGER NOT NULL, `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN', `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`tablero_id`) REFERENCES `tableros` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tarifas_hora` ADD INDEX `tarifas_hora_tablero_id_usuario_id` (`tablero_id`, `usuario_id`);

-- TipoBoleto
CREATE TABLE `boleto_tipos` (`id` INTEGER auto_increment , `evento_id` INTEGER NOT NULL, `nombre` VARCHAR(80) NOT NULL, `descripcion` VARCHAR(300), `precio_centavos` INTEGER NOT NULL DEFAULT 0, `cupo` INTEGER, `vendidos` INTEGER NOT NULL DEFAULT 0, `venta_desde` DATETIME, `venta_hasta` DATETIME, `max_por_persona` INTEGER NOT NULL DEFAULT 10, `activo` TINYINT(1) NOT NULL DEFAULT true, `orden` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `boleto_tipos` ADD INDEX `boleto_tipos_evento_id` (`evento_id`);

-- OrdenBoleto
CREATE TABLE `boleto_ordenes` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `evento_id` INTEGER NOT NULL, `tipo_boleto_id` INTEGER NOT NULL, `cantidad` INTEGER NOT NULL, `precio_unitario_centavos` INTEGER NOT NULL, `total_centavos` INTEGER NOT NULL, `moneda` VARCHAR(3) NOT NULL DEFAULT 'MXN', `proveedor` ENUM('gratis', 'demo', 'stripe', 'mercadopago') NOT NULL, `estado` ENUM('pendiente', 'pagada', 'fallida', 'reembolsada') NOT NULL DEFAULT 'pendiente', `referencia_externa` VARCHAR(255), `pago_externo_id` VARCHAR(255), `url_pago` VARCHAR(1000), `motivo_fallo` VARCHAR(255), `expira_en` DATETIME, `pagada_en` DATETIME, `reembolsada_en` DATETIME, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`tipo_boleto_id`) REFERENCES `boleto_tipos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `boleto_ordenes` ADD INDEX `boleto_ordenes_usuario_id` (`usuario_id`);
ALTER TABLE `boleto_ordenes` ADD INDEX `boleto_ordenes_evento_id_estado` (`evento_id`, `estado`);
ALTER TABLE `boleto_ordenes` ADD INDEX `boleto_ordenes_estado_expira_en` (`estado`, `expira_en`);

-- Boleto
CREATE TABLE `boletos` (`id` INTEGER auto_increment , `codigo` VARCHAR(120) NOT NULL UNIQUE, `evento_id` INTEGER NOT NULL, `tipo_boleto_id` INTEGER NOT NULL, `orden_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `estado` ENUM('valido', 'usado', 'cancelado', 'reembolsado') NOT NULL DEFAULT 'valido', `usado_en` DATETIME, `usado_por` INTEGER, `transferido_de` INTEGER, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`tipo_boleto_id`) REFERENCES `boleto_tipos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`orden_id`) REFERENCES `boleto_ordenes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `boletos` ADD INDEX `boletos_evento_id_estado` (`evento_id`, `estado`);
ALTER TABLE `boletos` ADD INDEX `boletos_usuario_id` (`usuario_id`);
ALTER TABLE `boletos` ADD INDEX `boletos_orden_id` (`orden_id`);

-- EventoStaff
CREATE TABLE `evento_staff` (`id` INTEGER auto_increment , `evento_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `agregado_por` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `evento_staff` ADD UNIQUE INDEX `evento_staff_evento_id_usuario_id` (`evento_id`, `usuario_id`);

-- Anuncio
CREATE TABLE `anuncios` (`id` INTEGER auto_increment , `vendedor_id` INTEGER NOT NULL, `grupo_id` INTEGER, `titulo` VARCHAR(120) NOT NULL, `descripcion` TEXT, `tipo` ENUM('producto', 'servicio') NOT NULL DEFAULT 'producto', `categoria` ENUM('electronica', 'hogar', 'ropa', 'vehiculos', 'libros_escuela', 'deportes', 'juguetes', 'servicios', 'inmuebles', 'otros') NOT NULL DEFAULT 'otros', `condicion` ENUM('nuevo', 'como_nuevo', 'usado', 'para_piezas'), `modo_precio` ENUM('fijo', 'a_convenir', 'gratis') NOT NULL DEFAULT 'fijo', `precio` DECIMAL(12,2), `moneda` ENUM('MXN', 'USD', 'EUR', 'COP', 'ARS', 'CLP', 'PEN', 'GTQ') NOT NULL DEFAULT 'MXN', `ubicacion` VARCHAR(150) NOT NULL, `entrega_en_persona` TINYINT(1) NOT NULL DEFAULT true, `entrega_envio` TINYINT(1) NOT NULL DEFAULT false, `estado` ENUM('activo', 'reservado', 'vendido', 'pausado') NOT NULL DEFAULT 'activo', `total_vistas` INTEGER NOT NULL DEFAULT 0, `total_guardados` INTEGER NOT NULL DEFAULT 0, `total_interesados` INTEGER NOT NULL DEFAULT 0, `comprador_id` INTEGER, `renovado_en` DATETIME NOT NULL, `vendido_en` DATETIME, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`vendedor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`comprador_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `anuncios` ADD INDEX `anuncios_estado_renovado_en` (`estado`, `renovado_en`);
ALTER TABLE `anuncios` ADD INDEX `anuncios_vendedor_id` (`vendedor_id`);
ALTER TABLE `anuncios` ADD INDEX `anuncios_categoria` (`categoria`);
ALTER TABLE `anuncios` ADD INDEX `anuncios_grupo_id` (`grupo_id`);
ALTER TABLE `anuncios` ADD INDEX `anuncios_precio` (`precio`);

-- AnuncioFoto
CREATE TABLE `anuncio_fotos` (`id` INTEGER auto_increment , `anuncio_id` INTEGER NOT NULL, `url` VARCHAR(500) NOT NULL, `archivo_id` VARCHAR(300), `orden` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`anuncio_id`) REFERENCES `anuncios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `anuncio_fotos` ADD INDEX `anuncio_fotos_anuncio_id_orden` (`anuncio_id`, `orden`);

-- AnuncioGuardado
CREATE TABLE `anuncio_guardados` (`id` INTEGER auto_increment , `anuncio_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`anuncio_id`) REFERENCES `anuncios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `anuncio_guardados` ADD UNIQUE INDEX `anuncio_guardados_anuncio_id_usuario_id` (`anuncio_id`, `usuario_id`);

-- AnuncioVisita
CREATE TABLE `anuncio_visitas` (`id` INTEGER auto_increment , `anuncio_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`anuncio_id`) REFERENCES `anuncios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `anuncio_visitas` ADD UNIQUE INDEX `anuncio_visitas_anuncio_id_usuario_id` (`anuncio_id`, `usuario_id`);
ALTER TABLE `anuncio_visitas` ADD INDEX `anuncio_visitas_usuario_id_fecha_actualizacion` (`usuario_id`, `fecha_actualizacion`);

-- AnuncioInteresado
CREATE TABLE `anuncio_interesados` (`id` INTEGER auto_increment , `anuncio_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `chat_id` INTEGER, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`anuncio_id`) REFERENCES `anuncios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `anuncio_interesados` ADD UNIQUE INDEX `anuncio_interesados_anuncio_id_usuario_id` (`anuncio_id`, `usuario_id`);

-- AnuncioReporte
CREATE TABLE `anuncio_reportes` (`id` INTEGER auto_increment , `anuncio_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `motivo` ENUM('estafa', 'prohibido', 'enganoso', 'duplicado', 'ofensivo', 'ya_vendido', 'otro') NOT NULL, `detalle` VARCHAR(500), `estado` ENUM('pendiente', 'revisado', 'descartado') NOT NULL DEFAULT 'pendiente', `revisado_por` INTEGER, `revisado_en` DATETIME, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`anuncio_id`) REFERENCES `anuncios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `anuncio_reportes` ADD UNIQUE INDEX `anuncio_reportes_anuncio_id_usuario_id` (`anuncio_id`, `usuario_id`);
ALTER TABLE `anuncio_reportes` ADD INDEX `anuncio_reportes_estado` (`estado`);

-- CalificacionVendedor
CREATE TABLE `calificaciones_vendedor` (`id` INTEGER auto_increment , `vendedor_id` INTEGER NOT NULL, `comprador_id` INTEGER NOT NULL, `anuncio_id` INTEGER, `titulo_anuncio` VARCHAR(120) NOT NULL, `puntuacion` INTEGER NOT NULL, `comentario` VARCHAR(500), `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`vendedor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`comprador_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`anuncio_id`) REFERENCES `anuncios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `calificaciones_vendedor` ADD INDEX `calificaciones_vendedor_vendedor_id` (`vendedor_id`);
ALTER TABLE `calificaciones_vendedor` ADD UNIQUE INDEX `calificaciones_vendedor_anuncio_id_comprador_id` (`anuncio_id`, `comprador_id`);

-- HistoriaDestacada
CREATE TABLE `historias_destacadas` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `titulo` VARCHAR(40) NOT NULL, `portada_url` VARCHAR(500), `portada_s3` VARCHAR(300), `portada_historia_id` INTEGER, `orden` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`portada_historia_id`) REFERENCES `historias` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `historias_destacadas` ADD INDEX `historias_destacadas_usuario_id_orden` (`usuario_id`, `orden`);

-- HistoriaDestacadaItem
CREATE TABLE `historias_destacadas_items` (`id` INTEGER auto_increment , `destacada_id` INTEGER NOT NULL, `historia_id` INTEGER NOT NULL, `orden` INTEGER NOT NULL DEFAULT 0, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`destacada_id`) REFERENCES `historias_destacadas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`historia_id`) REFERENCES `historias` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `historias_destacadas_items` ADD UNIQUE INDEX `historias_destacadas_items_destacada_id_historia_id` (`destacada_id`, `historia_id`);

-- EventoEstadistica
CREATE TABLE `estadisticas_eventos` (`id` INTEGER auto_increment , `tipo` ENUM('impresion', 'visita_perfil', 'clic_enlace') NOT NULL, `dueno_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `publicacion_id` INTEGER, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`dueno_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `estadisticas_eventos` ADD INDEX `est_eventos_usuario_tipo_pub_fecha` (`usuario_id`, `tipo`, `publicacion_id`, `fecha_creacion`);
ALTER TABLE `estadisticas_eventos` ADD INDEX `estadisticas_eventos_dueno_id_tipo_fecha_creacion` (`dueno_id`, `tipo`, `fecha_creacion`);

-- EstadisticaPublicacionDiaria
CREATE TABLE `estadisticas_publicaciones_diarias` (`id` INTEGER auto_increment , `publicacion_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `fecha` DATE NOT NULL, `impresiones` INTEGER NOT NULL DEFAULT 0, `alcance` INTEGER NOT NULL DEFAULT 0, `reproducciones` INTEGER NOT NULL DEFAULT 0, `clics_enlace` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (`id`), FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `estadisticas_publicaciones_diarias` ADD UNIQUE INDEX `estadisticas_publicaciones_diarias_publicacion_id_fecha` (`publicacion_id`, `fecha`);
ALTER TABLE `estadisticas_publicaciones_diarias` ADD INDEX `estadisticas_publicaciones_diarias_usuario_id_fecha` (`usuario_id`, `fecha`);

-- EstadisticaPerfilDiaria
CREATE TABLE `estadisticas_perfiles_diarias` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `fecha` DATE NOT NULL, `visitas_perfil` INTEGER NOT NULL DEFAULT 0, `seguidores_ganados` INTEGER NOT NULL DEFAULT 0, `seguidores_perdidos` INTEGER NOT NULL DEFAULT 0, `reproducciones_historias` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `estadisticas_perfiles_diarias` ADD UNIQUE INDEX `estadisticas_perfiles_diarias_usuario_id_fecha` (`usuario_id`, `fecha`);

-- ReporteContenido
CREATE TABLE `reportes_contenido` (`id` INTEGER auto_increment , `tipo` ENUM('publicacion', 'comentario', 'mensaje_chat', 'mensaje_grupo', 'usuario', 'grupo', 'evento', 'publicacion_canal') NOT NULL, `contenido_id` INTEGER NOT NULL, `usuario_id` INTEGER NOT NULL, `autor_id` INTEGER, `motivo` ENUM('Acoso o bullying', 'Violencia o daño', 'Spam o publicidad', 'Información falsa', 'Suplantación de identidad', 'Lenguaje ofensivo', 'Otro') NOT NULL DEFAULT 'Otro', `descripcion` TEXT, `copia` TEXT, `estado` ENUM('pendiente', 'resuelto', 'descartado') NOT NULL DEFAULT 'pendiente', `resuelto_por` INTEGER, `fecha_resolucion` DATETIME, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `reportes_contenido` ADD UNIQUE INDEX `reportes_contenido_tipo_contenido_id_usuario_id` (`tipo`, `contenido_id`, `usuario_id`);
ALTER TABLE `reportes_contenido` ADD INDEX `reportes_contenido_estado_tipo` (`estado`, `tipo`);
ALTER TABLE `reportes_contenido` ADD INDEX `reportes_contenido_autor_id` (`autor_id`);

-- AccionModeracion
CREATE TABLE `acciones_moderacion` (`id` INTEGER auto_increment , `admin_id` INTEGER, `accion` ENUM('descartar', 'ocultar', 'borrar', 'advertir', 'suspender', 'levantar_suspension') NOT NULL, `tipo` ENUM('publicacion', 'comentario', 'mensaje_chat', 'mensaje_grupo', 'usuario', 'grupo', 'evento', 'publicacion_canal'), `contenido_id` INTEGER, `autor_id` INTEGER, `detalle` TEXT, `fecha_creacion` DATETIME, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `acciones_moderacion` ADD INDEX `acciones_moderacion_tipo_contenido_id` (`tipo`, `contenido_id`);
ALTER TABLE `acciones_moderacion` ADD INDEX `acciones_moderacion_autor_id` (`autor_id`);

-- NotaModeracion
CREATE TABLE `notas_moderacion` (`id` INTEGER auto_increment , `admin_id` INTEGER NOT NULL, `tipo` ENUM('publicacion', 'comentario', 'mensaje_chat', 'mensaje_grupo', 'usuario', 'grupo', 'evento', 'publicacion_canal') NOT NULL, `contenido_id` INTEGER NOT NULL, `texto` TEXT NOT NULL, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`admin_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `notas_moderacion` ADD INDEX `notas_moderacion_tipo_contenido_id` (`tipo`, `contenido_id`);

-- PalabraProhibida
CREATE TABLE `palabras_prohibidas` (`id` INTEGER auto_increment , `palabra` VARCHAR(100) NOT NULL UNIQUE, `coincidencia` ENUM('exacta', 'contiene') NOT NULL DEFAULT 'exacta', `accion` ENUM('censurar', 'bloquear') NOT NULL DEFAULT 'censurar', `aplica_a` VARCHAR(100) NOT NULL DEFAULT 'publicacion,comentario,mensaje,nombre', `activa` TINYINT(1) NOT NULL DEFAULT true, `creado_por` INTEGER, `fecha_creacion` DATETIME, `fecha_actualizacion` DATETIME, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Suspension
CREATE TABLE `suspensiones` (`id` INTEGER auto_increment , `usuario_id` INTEGER NOT NULL, `admin_id` INTEGER, `motivo` TEXT, `hasta` DATETIME, `activa` TINYINT(1) NOT NULL DEFAULT true, `levantada_en` DATETIME, `fecha_creacion` DATETIME, PRIMARY KEY (`id`), FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `suspensiones` ADD INDEX `suspensiones_usuario_id_activa` (`usuario_id`, `activa`);
ALTER TABLE `suspensiones` ADD INDEX `suspensiones_activa_hasta` (`activa`, `hasta`);

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE = @OLD_SQL_MODE;

-- Listo. Arranca el backend con: cd backend && npm run dev
