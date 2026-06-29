import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { configureAuth } from './auth.js';
import { buildRouter } from './routes.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false, // relaxed for Vite dev / SPA
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Tiered rate limiting.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts, slow down' },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded' },
  });

  configureAuth(app);

  // Apply auth limiter to sensitive endpoints, general limiter to everything else.
  // Disabled under test so repeated logins in the suite aren't throttled.
  if (process.env.NODE_ENV !== 'test') {
    app.use('/api/login', authLimiter);
    app.use('/api/register', authLimiter);
    app.use('/api', apiLimiter);
  }

  app.use('/api', buildRouter());

  // 404 for unknown API routes.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Consistent error shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    const message = status === 500 ? 'Internal server error' : err?.message || 'Error';
    if (status === 500) console.error('[error]', err);
    res.status(status).json({ error: message });
  });

  return app;
}
