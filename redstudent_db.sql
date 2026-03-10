-- MySQL dump 10.13  Distrib 8.0.43, for Linux (x86_64)
--
-- Host: trinoflogdatabase.c9002ys6mvo4.us-east-2.rds.amazonaws.com    Database: redstudent_db
-- ------------------------------------------------------
-- Server version	8.0.42

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `comentarios`
--

DROP TABLE IF EXISTS `comentarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `comentarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicacion_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `texto` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_publicacion` (`publicacion_id`),
  KEY `idx_usuario` (`usuario_id`),
  CONSTRAINT `comentarios_ibfk_1` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `comentarios_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `comentarios`
--

/*!40000 ALTER TABLE `comentarios` DISABLE KEYS */;
INSERT INTO `comentarios` VALUES (3,2,2,'ta cuichu joven','2025-11-12 06:12:47'),(4,1,2,'xdxdxd','2025-11-12 06:12:55'),(5,3,3,'QUE?','2025-11-12 06:28:24'),(7,7,4,'Se mira bien :D','2025-11-13 15:40:01'),(8,8,1,'xd','2025-11-14 01:13:25'),(9,7,1,'xd','2025-11-16 06:12:45'),(10,11,1,'a','2025-11-16 06:16:25'),(11,10,1,'a','2025-11-16 06:18:46'),(14,9,1,'Buena imagen me gusto','2025-11-17 03:16:17'),(16,9,1,'**** empresa','2025-11-17 03:17:14'),(17,9,1,'*****************','2025-11-17 03:19:55'),(18,9,1,'Empresa','2025-11-17 03:20:03'),(19,9,1,'***** empresa','2025-11-17 03:20:15'),(20,9,1,'****','2025-11-17 03:26:48'),(21,9,1,'****** *****','2025-11-17 03:27:01'),(22,12,1,'sasas','2025-11-17 03:27:18'),(23,12,1,'*****','2025-11-17 03:27:25'),(24,13,1,'coso','2025-11-17 23:05:16'),(25,13,5,'Un perro','2025-11-18 06:42:32'),(26,7,5,'Chido','2025-11-18 07:03:21'),(27,7,5,'Chido','2025-11-18 07:03:21'),(28,7,5,'Está perro','2025-11-18 07:03:39'),(29,7,5,'Está bien chido','2025-11-18 07:04:00'),(30,11,5,'Si','2025-11-18 15:21:32'),(31,22,1,'esta chida','2025-11-18 15:21:52'),(32,22,1,'xd','2025-11-18 15:22:03'),(33,10,5,'Una comentario','2025-11-18 15:38:33'),(34,9,6,'***** empresa','2025-11-18 15:42:03'),(35,9,4,'Vas y ******************','2025-11-18 15:42:23'),(36,21,1,'no puede ser','2025-11-19 07:00:01'),(39,21,1,'****','2025-11-19 07:00:18');
/*!40000 ALTER TABLE `comentarios` ENABLE KEYS */;

--
-- Table structure for table `compartidos`
--

DROP TABLE IF EXISTS `compartidos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `compartidos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicacion_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `compartido_con_usuario_id` int DEFAULT NULL,
  `plataforma` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `usuario_id` (`usuario_id`),
  KEY `compartido_con_usuario_id` (`compartido_con_usuario_id`),
  KEY `idx_publicacion` (`publicacion_id`),
  CONSTRAINT `compartidos_ibfk_1` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `compartidos_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `compartidos_ibfk_3` FOREIGN KEY (`compartido_con_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `compartidos`
--

/*!40000 ALTER TABLE `compartidos` DISABLE KEYS */;
/*!40000 ALTER TABLE `compartidos` ENABLE KEYS */;

--
-- Table structure for table `documentos`
--

DROP TABLE IF EXISTS `documentos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `documentos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `publicacion_id` int DEFAULT NULL,
  `documento_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `documento_s3` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre_archivo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tamano_archivo` bigint NOT NULL,
  `tipo_archivo` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `icono` enum('fa-file-pdf','fa-file-word','fa-file-excel','fa-file-powerpoint','fa-file-archive','fa-file-csv','fa-file-code','fa-file') COLLATE utf8mb4_unicode_ci DEFAULT 'fa-file',
  `color` enum('text-red-500','text-blue-500','text-green-500','text-yellow-500','text-orange-500','text-purple-500','text-pink-500','text-indigo-500','text-gray-500','text-teal-500') COLLATE utf8mb4_unicode_ci DEFAULT 'text-gray-500',
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_usuario` (`usuario_id`),
  KEY `idx_publicacion` (`publicacion_id`),
  CONSTRAINT `documentos_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_documento_publicacion` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `documentos`
--

/*!40000 ALTER TABLE `documentos` DISABLE KEYS */;
INSERT INTO `documentos` VALUES (1,1,NULL,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1762928394085.pdf','AplicaciÃ³n de los mÃ©todos formales.pdf',459907,'application/pdf','fa-file-pdf','text-red-500',NULL,'2025-11-12 06:19:57'),(2,1,NULL,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1762928589977.pdf','Estructura de los Agentes.pdf',275721,'application/pdf','fa-file-pdf','text-red-500',NULL,'2025-11-12 06:23:10'),(3,2,NULL,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-2-1762928606541.pdf','PrÃ¡ctica_5.pdf',199319,'application/pdf','fa-file-pdf','text-red-500',NULL,'2025-11-12 06:23:26'),(5,1,NULL,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1762928707020.pdf','Estructura_de_los_Agentes.pdf',275721,'application/pdf','fa-file-pdf','text-red-500',NULL,'2025-11-12 06:25:07'),(6,1,NULL,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1762928858615.pdf','Aplicacion_de_los_metodos_formales.pdf',459907,'application/pdf','fa-file-pdf','text-red-500',NULL,'2025-11-12 06:27:39'),(7,1,NULL,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1762995595081.docx','Practica7.docx',384234,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','fa-file-word','text-blue-500',NULL,'2025-11-13 00:59:55'),(8,1,13,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1763353113263-664.docx','3.10 Ejemplo.docx',186354,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','fa-file-word','text-blue-500',NULL,'2025-11-17 04:18:35'),(9,1,14,NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/documentos/doc-1-1763423649187-2074.docx','Actividad 2.1 REAS.docx',325955,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','fa-file-word','text-blue-500',NULL,'2025-11-17 23:54:12');
/*!40000 ALTER TABLE `documentos` ENABLE KEYS */;

--
-- Table structure for table `etiquetas`
--

DROP TABLE IF EXISTS `etiquetas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `etiquetas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `icono` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'fa-tag',
  `color` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'teal',
  `total_posts` int DEFAULT '0',
  `tendencia` tinyint(1) DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  KEY `idx_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `etiquetas`
--

/*!40000 ALTER TABLE `etiquetas` DISABLE KEYS */;
/*!40000 ALTER TABLE `etiquetas` ENABLE KEYS */;

--
-- Table structure for table `likes`
--

DROP TABLE IF EXISTS `likes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `likes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicacion_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `publicacion_id` (`publicacion_id`,`usuario_id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `likes_ibfk_1` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `likes_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `likes`
--

/*!40000 ALTER TABLE `likes` DISABLE KEYS */;
INSERT INTO `likes` VALUES (2,2,2,'2025-11-12 05:57:04'),(3,3,2,'2025-11-12 06:03:25'),(4,1,2,'2025-11-12 06:03:27'),(5,2,3,'2025-11-12 06:28:15'),(6,7,4,'2025-11-13 15:39:44'),(7,9,1,'2025-11-17 04:35:08'),(8,10,1,'2025-11-17 04:49:40'),(9,8,1,'2025-11-17 04:49:52'),(11,14,5,'2025-11-18 06:42:08'),(12,12,5,'2025-11-18 06:51:01'),(13,7,5,'2025-11-18 07:04:11'),(14,11,5,'2025-11-18 07:07:34'),(15,2,5,'2025-11-18 15:23:48'),(16,22,6,'2025-11-18 15:26:55'),(17,23,6,'2025-11-18 15:28:28'),(18,10,4,'2025-11-18 15:38:06'),(19,8,4,'2025-11-18 15:38:08');
/*!40000 ALTER TABLE `likes` ENABLE KEYS */;

--
-- Table structure for table `notificaciones`
--

DROP TABLE IF EXISTS `notificaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `de_usuario_id` int DEFAULT NULL,
  `tipo` enum('like','comment','follow','share') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `publicacion_id` int DEFAULT NULL,
  `mensaje` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `leida` tinyint(1) DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `de_usuario_id` (`de_usuario_id`),
  KEY `publicacion_id` (`publicacion_id`),
  KEY `idx_usuario` (`usuario_id`),
  KEY `idx_leida` (`leida`),
  CONSTRAINT `notificaciones_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notificaciones_ibfk_2` FOREIGN KEY (`de_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notificaciones_ibfk_3` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notificaciones`
--

/*!40000 ALTER TABLE `notificaciones` DISABLE KEYS */;
INSERT INTO `notificaciones` VALUES (10,2,3,'comment',3,'@Juan comentó tu publicación',1,'2025-11-12 06:28:24'),(12,1,4,'comment',7,'@Racknes comentó tu publicación',1,'2025-11-13 15:39:51'),(13,1,4,'comment',7,'@Racknes comentó tu publicación',1,'2025-11-13 15:40:01'),(14,4,1,'follow',NULL,'@TrinomiO123 comenzó a seguirte',1,'2025-11-14 01:12:52'),(15,4,1,'comment',8,'@TrinomiO123 comentó tu publicación',1,'2025-11-14 01:13:25'),(16,4,1,'comment',10,'@TrinomiO123 comentó tu publicación',1,'2025-11-16 06:18:46'),(17,4,1,'like',10,'@TrinomiO123 le dio like a tu publicación',1,'2025-11-17 04:49:40'),(18,4,1,'like',8,'@TrinomiO123 le dio like a tu publicación',1,'2025-11-17 04:49:52'),(19,1,5,'follow',NULL,'@Jesusss comenzó a seguirte',1,'2025-11-18 01:13:44'),(21,1,5,'like',14,'le gustó tu publicación',1,'2025-11-18 06:42:08'),(22,1,5,'comment',13,'comentó tu publicación',1,'2025-11-18 06:42:32'),(23,1,5,'like',12,'le gustó tu publicación',1,'2025-11-18 06:51:01'),(24,1,5,'comment',7,'comentó tu publicación',1,'2025-11-18 07:03:21'),(25,1,5,'comment',7,'comentó tu publicación',1,'2025-11-18 07:03:21'),(26,1,5,'comment',7,'comentó tu publicación',1,'2025-11-18 07:03:39'),(27,1,5,'comment',7,'comentó tu publicación',1,'2025-11-18 07:04:01'),(28,1,5,'like',7,'le gustó tu publicación',1,'2025-11-18 07:04:11'),(29,1,5,'like',11,'le gustó tu publicación',1,'2025-11-18 07:07:34'),(31,5,1,'follow',NULL,'comenzó a seguirte',1,'2025-11-18 15:17:31'),(32,1,5,'comment',11,'comentó tu publicación',1,'2025-11-18 15:21:32'),(33,5,1,'comment',22,'comentó tu publicación',1,'2025-11-18 15:21:52'),(34,5,1,'comment',22,'comentó tu publicación',1,'2025-11-18 15:22:03'),(35,1,5,'like',2,'le gustó tu publicación',0,'2025-11-18 15:23:48'),(36,5,6,'like',22,'le gustó tu publicación',1,'2025-11-18 15:26:55'),(37,5,6,'like',23,'le gustó tu publicación',1,'2025-11-18 15:28:28'),(38,1,6,'follow',NULL,'comenzó a seguirte',0,'2025-11-18 15:29:17'),(39,4,5,'follow',NULL,'comenzó a seguirte',1,'2025-11-18 15:35:19'),(40,4,5,'comment',10,'comentó tu publicación',1,'2025-11-18 15:38:33'),(41,1,6,'comment',9,'comentó tu publicación',0,'2025-11-18 15:42:03'),(42,1,4,'comment',9,'comentó tu publicación',0,'2025-11-18 15:42:23');
/*!40000 ALTER TABLE `notificaciones` ENABLE KEYS */;

--
-- Table structure for table `publicaciones`
--

DROP TABLE IF EXISTS `publicaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publicaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `contenido` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `imagen_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `imagen_s3` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `categoria` enum('General','Tecnología','Ciencias','Artes y Cultura','Deportes','Salud y Bienestar','Vida Universitaria','Opinión','Entrevistas') COLLATE utf8mb4_unicode_ci DEFAULT 'General',
  `color_categoria` enum('bg-orange-500','bg-teal-500','bg-purple-500','bg-pink-500','bg-blue-500','bg-green-500','bg-orange-600','bg-indigo-500','bg-yellow-500') COLLATE utf8mb4_unicode_ci DEFAULT 'bg-orange-500',
  `total_likes` int DEFAULT '0',
  `total_dislikes` int DEFAULT '0',
  `total_comentarios` int DEFAULT '0',
  `total_compartidos` int DEFAULT '0',
  `oculto` tinyint(1) DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `requiere_revision` tinyint DEFAULT '0',
  `analisis_censura` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_usuario_id` (`usuario_id`),
  KEY `idx_fecha` (`fecha_creacion` DESC),
  CONSTRAINT `publicaciones_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `publicaciones`
--

/*!40000 ALTER TABLE `publicaciones` DISABLE KEYS */;
INSERT INTO `publicaciones` VALUES (1,1,'Aqui terminando el proyecto🥳',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/imagen-1-1762844805040.png','General','bg-orange-500',1,0,1,0,0,'2025-11-11 07:06:45','2025-11-17 23:19:49',0,NULL),(2,1,'No me salio la practica',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/imagen-1-1762926652008.png','General','bg-orange-500',3,0,1,0,0,'2025-11-12 05:50:52','2025-11-18 15:23:48',0,NULL),(3,2,'presenten morritas de prepa, que no sea la de la uas porque ya me corrieron de ahi xdxdxd',NULL,NULL,'General','bg-orange-500',1,0,1,0,0,'2025-11-12 05:57:30','2025-11-17 23:19:49',0,NULL),(4,2,'presenten morras del gym',NULL,NULL,'Salud y Bienestar','bg-green-500',0,0,0,0,0,'2025-11-12 06:16:51','2025-11-12 06:16:51',0,NULL),(7,1,'mi proyecto',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/imagen-1-1763006804570.png','General','bg-orange-500',2,0,2,0,0,'2025-11-13 04:06:48','2025-11-18 07:04:11',0,'{\"fecha\": \"2025-11-13T04:06:48.035Z\", \"imagen\": {\"razon\": \"La imagen muestra una interfaz de usuario para crear una publicación en una plataforma social. El contenido de la publicación, \\\"mi proyecto\\\", es genérico y no presenta ningún problema de seguridad o contenido inapropiado. No hay indicios de contenido violento, sexual, ilegal o discriminatorio.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(8,4,'T1',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/imagen-4-1763048529117.webp','General','bg-orange-500',2,0,1,0,0,'2025-11-13 15:42:12','2025-11-18 15:38:08',0,'{\"fecha\": \"2025-11-13T15:42:12.126Z\", \"imagen\": {\"razon\": \"La imagen es un emoji con una expresión de angustia, pero no contiene contenido inapropiado en el contexto de una publicación educativa genérica como \\\"T1\\\". No hay violencia, contenido sexual, invasión de privacidad, promoción de sustancias ilegales, acoso o discriminación.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 4, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(9,1,'buena empresa',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/imagen-1-1763082028925.png','General','bg-orange-500',1,0,7,0,0,'2025-11-14 01:00:31','2025-11-17 23:19:49',0,'{\"fecha\": \"2025-11-14T01:00:31.360Z\", \"imagen\": {\"razon\": \"La imagen parece ser un logotipo o una representación gráfica de una empresa llamada ICAS. No contiene contenido inapropiado, violento, sexual, discriminatorio ni promueve actividades ilegales. No hay marcas de agua sospechosas ni violaciones de privacidad.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(10,4,':\'c',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/imagen-4-1763082724514.jpg','General','bg-orange-500',2,0,1,0,0,'2025-11-14 01:12:07','2025-11-18 15:38:06',0,'{\"fecha\": \"2025-11-14T01:12:07.278Z\", \"imagen\": {\"razon\": \"La imagen es un cómic humorístico sobre un derrame de café y la fantasía de detener el tiempo. No contiene contenido inapropiado para una plataforma escolar universitaria.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 4, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(11,1,'Aqui terminando una practica',NULL,NULL,'Ciencias','bg-purple-500',1,0,1,0,0,'2025-11-16 04:50:26','2025-11-18 07:07:34',0,'{\"fecha\": \"2025-11-16T04:50:26.870Z\", \"imagen\": null, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(12,1,'hola',NULL,NULL,'General','bg-orange-500',1,0,2,0,0,'2025-11-16 05:04:05','2025-11-18 06:51:01',0,'{\"fecha\": \"2025-11-16T05:04:05.204Z\", \"imagen\": null, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(13,1,'mi tarea',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763353113195.jpg','General','bg-orange-500',0,0,1,0,0,'2025-11-17 04:18:35','2025-11-17 23:19:49',0,'{\"fecha\": \"2025-11-17T04:18:35.717Z\", \"imagen\": {\"razon\": \"La imagen muestra un meme humorístico de un perro con gafas y dientes falsos, sin contenido ofensivo o inapropiado para una red social universitaria.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(14,1,'UNA TAREA de IA',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763423649111.jpg','General','bg-orange-500',1,0,0,0,0,'2025-11-17 23:54:12','2025-11-18 06:42:08',0,'{\"fecha\": \"2025-11-17T23:54:12.141Z\", \"imagen\": {\"razon\": \"La imagen es un meme humorístico con un perro usando gafas y dientes falsos. No contiene desnudez, violencia, símbolos de odio ni información personal sensible.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(15,1,'Mi proyecto asi es',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763424522111.png','General','bg-orange-500',0,0,0,0,0,'2025-11-18 00:08:45','2025-11-18 00:08:45',0,'{\"fecha\": \"2025-11-18T00:08:45.196Z\", \"imagen\": {\"razon\": \"La publicación contiene comentarios y actualizaciones de estado en una red social, lo cual es apropiado para una red social universitaria.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(16,1,'Proyecto',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763424490573.png','General','bg-orange-500',0,0,0,0,0,'2025-11-18 00:08:59','2025-11-18 00:08:59',0,'{\"fecha\": \"2025-11-18T00:08:59.958Z\", \"imagen\": {\"razon\": \"La imagen parece ser una captura de pantalla de un perfil de red social con un meme de un perro con gafas. No hay contenido inapropiado visible.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(17,1,'Proyecto numero cinco vamos muy bien',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763424859345.png','Artes y Cultura','bg-pink-500',0,0,0,0,0,'2025-11-18 00:14:22','2025-11-18 00:14:22',0,'{\"fecha\": \"2025-11-18T00:14:22.172Z\", \"imagen\": {\"razon\": \"La publicación parece ser una actualización personal sobre una práctica relacionada con ciencias, lo cual es apropiado para una red social universitaria.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(18,1,'hola',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763425183671.png','General','bg-orange-500',0,0,0,0,0,'2025-11-18 00:20:32','2025-11-18 00:20:32',0,'{\"fecha\": \"2025-11-18T00:20:32.758Z\", \"imagen\": {\"razon\": \"La publicación parece ser una actualización de estado personal, sin contenido inapropiado.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(19,1,'una app movil',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763425270185.png','General','bg-orange-500',0,0,0,0,0,'2025-11-18 00:21:13','2025-11-18 00:21:13',0,'{\"fecha\": \"2025-11-18T00:21:13.009Z\", \"imagen\": {\"razon\": \"La publicación parece ser una actualización de estado personal en una red social, sin contenido inapropiado.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(20,1,'otra app movil',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763425287217.png','General','bg-orange-500',0,0,0,0,0,'2025-11-18 00:21:29','2025-11-18 00:21:29',0,'{\"fecha\": \"2025-11-18T00:21:29.796Z\", \"imagen\": {\"razon\": \"La imagen parece ser un placeholder para una imagen que aún no se ha cargado. El texto asociado a la publicación es inofensivo y no viola ninguna política.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(21,1,'una publicacion',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-1-1763479132605.jpeg','General','bg-orange-500',0,0,0,0,0,'2025-11-18 15:18:57','2025-11-18 15:18:57',0,'{\"fecha\": \"2025-11-18T15:18:57.522Z\", \"imagen\": {\"razon\": \"La imagen muestra un meme popular de internet, \'Cheems\', que es humorístico y no contiene contenido inapropiado según las directrices proporcionadas.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 95}, \"userId\": 1, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(22,5,'Una publicación de pruebas',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-5-1763479189546.jpg','General','bg-orange-500',1,0,0,0,0,'2025-11-18 15:20:03','2025-11-18 15:26:55',0,'{\"fecha\": \"2025-11-18T15:20:03.118Z\", \"imagen\": {\"razon\": \"La imagen muestra una geoda, que no contiene contenido inapropiado para una red social universitaria.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 5, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}'),(23,5,'Otra de prueba',NULL,'https://redstudent-uploads.s3.us-east-2.amazonaws.com/publicaciones/img-5-1763479681835.jpg','General','bg-orange-500',1,0,0,0,0,'2025-11-18 15:28:05','2025-11-18 15:28:28',0,'{\"fecha\": \"2025-11-18T15:28:05.876Z\", \"imagen\": {\"razon\": \"La imagen muestra un perro doméstico en un ambiente interior, sin contenido inapropiado.\", \"accion\": \"publico\", \"apropiada\": true, \"confianza\": 100}, \"userId\": 5, \"contenido\": {\"razon\": \"Contenido aprobado\", \"accion\": \"publico\", \"valido\": true, \"confianza\": 95, \"problemas\": []}, \"estadoFinal\": {\"nivel\": \"bajo\", \"razon\": \"Contenido e imagen apropiados\", \"estado\": \"APROBADO\", \"confianza\": 95}, \"publicacionId\": null}');
/*!40000 ALTER TABLE `publicaciones` ENABLE KEYS */;

--
-- Table structure for table `publicaciones_no_interesa`
--

DROP TABLE IF EXISTS `publicaciones_no_interesa`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publicaciones_no_interesa` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `publicacion_id` int NOT NULL,
  `categoria` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_no_interesa` (`usuario_id`,`publicacion_id`),
  KEY `idx_usuario_no_interesa` (`usuario_id`),
  KEY `idx_publicacion_no_interesa` (`publicacion_id`),
  KEY `idx_categoria_no_interesa` (`categoria`),
  CONSTRAINT `publicaciones_no_interesa_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `publicaciones_no_interesa_ibfk_2` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `publicaciones_no_interesa`
--

/*!40000 ALTER TABLE `publicaciones_no_interesa` DISABLE KEYS */;
/*!40000 ALTER TABLE `publicaciones_no_interesa` ENABLE KEYS */;

--
-- Table structure for table `publicaciones_ocultas`
--

DROP TABLE IF EXISTS `publicaciones_ocultas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publicaciones_ocultas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `publicacion_id` int NOT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unica_oculta` (`usuario_id`,`publicacion_id`),
  KEY `publicacion_id` (`publicacion_id`),
  CONSTRAINT `publicaciones_ocultas_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `publicaciones_ocultas_ibfk_2` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `publicaciones_ocultas`
--

/*!40000 ALTER TABLE `publicaciones_ocultas` DISABLE KEYS */;
INSERT INTO `publicaciones_ocultas` VALUES (1,2,1,'2025-11-12 06:09:42');
/*!40000 ALTER TABLE `publicaciones_ocultas` ENABLE KEYS */;

--
-- Table structure for table `publicaciones_secciones`
--

DROP TABLE IF EXISTS `publicaciones_secciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publicaciones_secciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicacion_id` int NOT NULL,
  `seccion_id` int NOT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unica_seccion` (`publicacion_id`,`seccion_id`),
  KEY `seccion_id` (`seccion_id`),
  CONSTRAINT `publicaciones_secciones_ibfk_1` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `publicaciones_secciones_ibfk_2` FOREIGN KEY (`seccion_id`) REFERENCES `secciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `publicaciones_secciones`
--

/*!40000 ALTER TABLE `publicaciones_secciones` DISABLE KEYS */;
INSERT INTO `publicaciones_secciones` VALUES (1,20,1,'2025-11-18 01:04:51'),(2,19,1,'2025-11-18 01:04:51'),(3,18,1,'2025-11-18 01:04:51');
/*!40000 ALTER TABLE `publicaciones_secciones` ENABLE KEYS */;

--
-- Table structure for table `reportes`
--

DROP TABLE IF EXISTS `reportes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reportes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `publicacion_id` int NOT NULL,
  `usuario_id` int NOT NULL,
  `motivo` enum('Acoso o bullying','Violencia o daño','Spam o publicidad','Información falsa','Suplantación de identidad','Lenguaje ofensivo','Otro') NOT NULL DEFAULT 'Otro',
  `descripcion` text,
  `fecha_reporte` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_reporte` (`publicacion_id`,`usuario_id`),
  KEY `usuario_id` (`usuario_id`),
  CONSTRAINT `reportes_ibfk_1` FOREIGN KEY (`publicacion_id`) REFERENCES `publicaciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reportes_ibfk_2` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reportes`
--

/*!40000 ALTER TABLE `reportes` DISABLE KEYS */;
INSERT INTO `reportes` VALUES (1,2,2,'Información falsa','si le salio la practica','2025-11-12 06:10:03');
/*!40000 ALTER TABLE `reportes` ENABLE KEYS */;

--
-- Table structure for table `secciones`
--

DROP TABLE IF EXISTS `secciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `secciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `icono` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'fa-folder',
  `color` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'from-gray-400 to-gray-600',
  `total_posts` int DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_usuario` (`usuario_id`),
  CONSTRAINT `secciones_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `secciones`
--

/*!40000 ALTER TABLE `secciones` DISABLE KEYS */;
INSERT INTO `secciones` VALUES (1,1,'PUBLICACION PERRONAS','fa-graduation-cap','from-blue-500 to-blue-600',3,'2025-11-18 01:04:13'),(2,1,'otra seccion','fa-graduation-cap','from-green-500 to-green-600',0,'2025-11-18 01:06:06');
/*!40000 ALTER TABLE `secciones` ENABLE KEYS */;

--
-- Table structure for table `seguidores`
--

DROP TABLE IF EXISTS `seguidores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `seguidores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `seguidor_id` int NOT NULL,
  `siguiendo_id` int NOT NULL,
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unico_seguidor` (`seguidor_id`,`siguiendo_id`),
  KEY `idx_seguidor` (`seguidor_id`),
  KEY `idx_siguiendo` (`siguiendo_id`),
  CONSTRAINT `seguidores_ibfk_1` FOREIGN KEY (`seguidor_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `seguidores_ibfk_2` FOREIGN KEY (`siguiendo_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `seguidores`
--

/*!40000 ALTER TABLE `seguidores` DISABLE KEYS */;
INSERT INTO `seguidores` VALUES (1,2,1,'2025-11-12 05:57:50'),(2,1,4,'2025-11-14 01:12:52'),(3,5,1,'2025-11-18 01:13:44'),(5,1,5,'2025-11-18 15:17:31'),(6,6,1,'2025-11-18 15:29:17'),(7,5,4,'2025-11-18 15:35:19');
/*!40000 ALTER TABLE `seguidores` ENABLE KEYS */;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre_usuario` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre_completo` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `contrasena` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `foto_perfil_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_perfil_s3` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_portada_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `foto_portada_s3` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `biografia` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `ubicacion` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `carrera` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_seguidores` int DEFAULT '0',
  `total_siguiendo` int DEFAULT '0',
  `total_posts` int DEFAULT '0',
  `mantener_sesion` tinyint(1) DEFAULT '0',
  `activo` tinyint(1) DEFAULT '1',
  `suspendido` tinyint(1) DEFAULT '0',
  `fecha_creacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_actualizacion` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre_usuario` (`nombre_usuario`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_nombre_usuario` (`nombre_usuario`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` VALUES (1,'TrinomiO123','juabngonzalez4@gmail.com','Juan Carlos de Jesus Gonzalez Lopez','$2b$10$tfuDHVOSvoawvUmBfI8bEuwLwuLeuZUkgZ4vMZIP9d8fk37uRocla','https://redstudent-uploads.s3.us-east-2.amazonaws.com/perfiles/foto_perfil-1-1763426450045.jpg','perfiles/foto_perfil-1-1763426450045.jpg','https://redstudent-uploads.s3.us-east-2.amazonaws.com/portadas/foto_portada-1-1763082848793.jpg','portadas/foto_portada-1-1763082848793.jpg','Estudiante de Ingieneria de Software muy pronto esclavo de IGAS','Mochis, Mexico','Ingeniería en Software',0,0,0,0,1,0,'2025-11-11 06:57:36','2025-11-18 00:40:50'),(2,'elasaltacunas','chuchin_ayala@gmail.com','Jesus Ayala','$2b$10$RvOnKrgneVv3MKwFx..7B.0Djz4c/NLMgbWASno/yWBlGTPdY1TYS','https://redstudent-uploads.s3.us-east-2.amazonaws.com/perfiles/foto_perfil-2-1762928309531.jpeg','perfiles/foto_perfil-2-1762928309531.jpeg','https://redstudent-uploads.s3.us-east-2.amazonaws.com/portadas/foto_portada-2-1762927519636.jpg','portadas/foto_portada-2-1762927519636.jpg','Gimrat bien locochon','Momochis','Licenciatura en levantar culitos en el gym',0,0,0,0,1,0,'2025-11-12 05:56:34','2025-11-12 06:18:29'),(3,'Juan','test1@gmail.com','Campos','$2b$10$KcsQFCrARRacK6uI/qJguOb6l3bx261FIGld9EahatDILr2QR1QZy',NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,1,0,'2025-11-12 06:28:07','2025-11-12 06:28:07'),(4,'Racknes','rafaalvvgo@gmail.com','Rafael Alvarez','$2b$10$ADZVz6csX5sNVvcym1b6HuKLn.4SxTUUfTFnb/wpDEK6XC7u4YNX.','https://redstudent-uploads.s3.us-east-2.amazonaws.com/perfiles/foto_perfil-4-1763048500183.png','perfiles/foto_perfil-4-1763048500183.png','https://redstudent-uploads.s3.us-east-2.amazonaws.com/portadas/foto_portada-4-1763048467377.jpg','portadas/foto_portada-4-1763048467377.jpg',NULL,'UAS CU','Ingeniería de software',0,0,0,0,1,0,'2025-11-13 15:38:37','2025-11-13 15:41:40'),(5,'Jesusss','juangonzalez4@gmail.com','Jesus López Rodríguez','$2b$10$fZRfA5hsIc9P7x2TEgj68OGFmcxlX.6kI5JF4GhCbB6hTWnWV4p12',NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,1,0,'2025-11-18 01:13:15','2025-11-18 01:13:15'),(6,'usuario_prueba','pruebapagina@gmail.com','Pruebas test','$2b$10$kVoO1q7aE4ADgNc8VhozMuKwfon/ZufWHa4ga4yxGMgi82f0hoktS',NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,1,0,'2025-11-18 15:26:45','2025-11-18 15:26:45');
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-19 15:31:49
