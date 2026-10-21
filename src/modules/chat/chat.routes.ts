import { Router } from 'express';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { chatController as c } from './chat.controller';
import { chatIdParams, enviarMensajeSchema, iniciarChatSchema, mensajeIdParams, mensajesQuery } from './chat.schemas';
import { temporalesSchema } from './mensajes-temporales';
import { reaccionSchema } from './reacciones';

export const chatRoutes = Router();

chatRoutes.use(auth.proteger);

chatRoutes.get('/lista', validate({ query: paginacionQuery }), c.lista);
chatRoutes.get('/mensajes/:chatId', validate({ params: chatIdParams, query: mensajesQuery }), c.mensajes);
chatRoutes.post('/iniciar', validate({ body: iniciarChatSchema }), c.iniciar);
chatRoutes.post('/enviar', upload.single('archivo'), validate({ body: enviarMensajeSchema }), c.enviar);
chatRoutes.put('/aceptar/:chatId', validate({ params: chatIdParams }), c.aceptar);
chatRoutes.put('/:chatId/leer', validate({ params: chatIdParams }), c.leer);
chatRoutes.delete('/mensajes/:mensajeId', validate({ params: mensajeIdParams }), c.eliminarMensaje);
// [canales] Mensajes temporales y reacciones
chatRoutes.put('/:chatId/temporales', validate({ params: chatIdParams, body: temporalesSchema }), c.temporales);
chatRoutes.put('/mensajes/:mensajeId/reaccion', validate({ params: mensajeIdParams, body: reaccionSchema }), c.reaccionar);
chatRoutes.delete('/mensajes/:mensajeId/reaccion', validate({ params: mensajeIdParams }), c.quitarReaccion);
