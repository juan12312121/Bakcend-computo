-- Migración: Agregar soporte de archivos adjuntos a mensajes_chat
ALTER TABLE mensajes_chat ADD COLUMN archivo_url VARCHAR(500) NULL;
ALTER TABLE mensajes_chat ADD COLUMN tipo_archivo VARCHAR(20) NULL;
