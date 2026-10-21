import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { hashtagController as c } from './hashtag.controller';
import { buscarHashtagsQuery, hashtagParams, publicacionesHashtagQuery } from './hashtag.schemas';

export const hashtagRoutes = Router();

// Rutas fijas antes de /:nombre
hashtagRoutes.get('/tendencias', c.tendencias);
hashtagRoutes.get('/buscar', validate({ query: buscarHashtagsQuery }), c.buscar);
hashtagRoutes.get('/:nombre/publicaciones', auth.opcional, validate({ params: hashtagParams, query: publicacionesHashtagQuery }), c.publicaciones);
hashtagRoutes.get('/:nombre', validate({ params: hashtagParams }), c.info);
