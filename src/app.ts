import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { origenesPermitidos } from './config/cors';
import { env } from './config/env';
import { ApiResponse } from './core/http/ApiResponse';
import { sequelize } from './infrastructure/database/models';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { cuerpoCrudoWebhook } from './modules/pagos/pago.routes';
import { apiRoutes } from './routes';

/** Se puede pasar otro router (las pruebas montan solo los módulos que prueban). */
export function crearApp(rutas: Router = apiRoutes): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: [...origenesPermitidos], credentials: true }));
  app.use(compression());
  // Stripe firma el cuerpo tal cual llega: el webhook necesita el cuerpo crudo, antes de express.json.
  app.use('/api/pagos/webhook', cuerpoCrudoWebhook);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV === 'development') app.use(morgan('dev'));

  app.get('/health', async (_req, res) => {
    await sequelize.authenticate();
    return ApiResponse.ok(res, { baseDeDatos: 'ok', entorno: env.NODE_ENV, timestamp: new Date().toISOString() }, 'API TrinoFlow funcionando');
  });

  app.use('/api', rutas);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
