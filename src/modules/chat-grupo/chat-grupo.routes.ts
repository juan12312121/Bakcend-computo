import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { temporalesSchema } from '../chat/mensajes-temporales';
import { reaccionSchema } from '../chat/reacciones';
import { chatGrupoController as c } from './chat-grupo.controller';
import { enviarMensajeGrupoSchema, grupoIdParams, mensajeGrupoParams, mensajesGrupoQuery } from './chat-grupo.schemas';

/** Chat de los grupos (`/api/grupos-chat`): solo miembros activos. */
export const chatGrupoRoutes = Router();

chatGrupoRoutes.use(auth.proteger);

// Ruta fija antes de /:grupoId
chatGrupoRoutes.get('/no-leidos', c.noLeidos);
chatGrupoRoutes.get('/:grupoId/mensajes', validate({ params: grupoIdParams, query: mensajesGrupoQuery }), c.mensajes);
chatGrupoRoutes.post(
  '/:grupoId/mensajes',
  upload.single('archivo'),
  validate({ params: grupoIdParams, body: enviarMensajeGrupoSchema }),
  c.enviar,
);
chatGrupoRoutes.put('/:grupoId/leer', validate({ params: grupoIdParams }), c.leer);
chatGrupoRoutes.delete('/:grupoId/mensajes/:mensajeId', validate({ params: mensajeGrupoParams }), c.eliminar);
// [canales] Ajustes del chat, mensajes temporales y reacciones
chatGrupoRoutes.get('/:grupoId/ajustes', validate({ params: grupoIdParams }), c.ajustes);
chatGrupoRoutes.put('/:grupoId/temporales', validate({ params: grupoIdParams, body: temporalesSchema }), c.temporales);
chatGrupoRoutes.put('/:grupoId/mensajes/:mensajeId/reaccion', validate({ params: mensajeGrupoParams, body: reaccionSchema }), c.reaccionar);
chatGrupoRoutes.delete('/:grupoId/mensajes/:mensajeId/reaccion', validate({ params: mensajeGrupoParams }), c.quitarReaccion);
