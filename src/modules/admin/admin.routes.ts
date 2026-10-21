import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { adminController as c } from './admin.controller';
import { logsQuery, motivoSchema, suspensionSchema } from './admin.schemas';

export const adminRoutes = Router();

// Todo el módulo exige sesión y rol admin.
adminRoutes.use(auth.proteger, auth.soloAdmin);

adminRoutes.get('/reportes', validate({ query: paginacionQuery }), c.reportes);
adminRoutes.delete('/publicaciones/:id', validate({ params: idParams, body: motivoSchema }), c.eliminarPublicacion);
adminRoutes.patch('/usuarios/:id/suspender', validate({ params: idParams, body: suspensionSchema }), c.suspender);
adminRoutes.get('/logs', validate({ query: logsQuery }), c.logs);
