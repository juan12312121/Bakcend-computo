-- Migración: Agregar soporte de archivos adjuntos a mensajes_chat
ALTER TABLE mensajes_chat ADD COLUMN IF NOT EXISTS archivo_url VARCHAR(500) NULL;
ALTER TABLE mensajes_chat ADD COLUMN IF NOT EXISTS tipo_archivo VARCHAR(20) NULL;
