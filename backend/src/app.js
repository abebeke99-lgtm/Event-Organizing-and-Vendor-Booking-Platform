import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformRoutes from './routes/platform.js';
import aboutRoutes, { adminRouter as adminAboutRoutes } from './routes/about.js';
import contactRoutes, { adminRouter as adminContactRoutes } from './routes/contact.js';
import vendorRoutes from './routes/vendor.js';
import customerRoutes from './routes/customer.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { requirePlatformRole } from './middleware/requirePlatformUser.js';
import { formatDatabaseError, getDatabaseFailureCode, pool, verifyDatabaseConnection } from './db.js';
import { asyncHandler } from './middleware/asyncHandler.js';

export function createApp({ database = pool, expectedDatabase = process.env.DB_NAME } = {}) {
  const app = express();
  const localOrigins = process.env.NODE_ENV === 'production'
    ? []
    : ['http://127.0.0.1:5173', 'http://localhost:5173'];
  const configuredOrigins = (process.env.WEB_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([...localOrigins, ...configuredOrigins]);
  const isAllowedOrigin = (requestOrigin) => !requestOrigin || allowedOrigins.has(requestOrigin);
  app.locals.systemSettings = {
    platform_status: process.env.PLATFORM_STATUS || 'open',
    maintenance_mode: process.env.MAINTENANCE_MODE === 'true',
  };
  app.locals.moduleLocks = {};
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin(requestOrigin, callback) {
      callback(null, isAllowedOrigin(requestOrigin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !isAllowedOrigin(req.headers.origin)) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  });
  app.get('/', (req, res) => res.json({
    status: 'ok',
    service: 'event-organizing-and-vendor-booking-api',
  }));
  app.get('/api/version', (req, res) => res.json({
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown',
    environment: process.env.NODE_ENV || 'development',
  }));
  app.get('/api/health', asyncHandler(async (req, res) => {
    try {
      await verifyDatabaseConnection(database, expectedDatabase);
    } catch (error) {
      console.error('Database health check failed:', formatDatabaseError(error));
      return res.status(503).json({
        status: 'unavailable',
        reasonCode: getDatabaseFailureCode(error),
      });
    }
    res.json({ status: 'ok' });
  }));
  app.use('/api/platform', platformRoutes);
  app.use('/api/about', aboutRoutes);
  app.use('/api/contact', contactRoutes);
  app.use('/api/vendor', requirePlatformRole('vendor'), vendorRoutes);
  app.use('/api/customer', requirePlatformRole('customer'), customerRoutes);
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }), authRoutes);
  app.use('/api/admin/about', requireAdmin, adminAboutRoutes);
  app.use('/api/admin/contact', requireAdmin, adminContactRoutes);
  app.use('/api/admin', requireAdmin, adminRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(`Request failed: ${req.method} ${req.originalUrl}`);
    console.error(error.stack || error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({ message: error.expose ? error.message : 'The request could not be completed.' });
  });

  return app;
}
