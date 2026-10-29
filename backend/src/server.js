import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformRoutes from './routes/platform.js';
import aboutRoutes from './routes/about.js';
import contactRoutes from './routes/contact.js';
import vendorRoutes from './routes/vendor.js';
import customerRoutes from './routes/customer.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { requirePlatformRole } from './middleware/requirePlatformUser.js';
import { pool } from './db.js';
import { asyncHandler } from './middleware/asyncHandler.js';

const app = express();
const localOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
const configuredOrigins = (process.env.CORS_ORIGIN || process.env.WEB_ORIGIN || '')
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
app.use((req,res,next) => {
  if (['POST','PATCH','PUT','DELETE'].includes(req.method) && !isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
});
app.get('/api/health', asyncHandler(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));
app.use('/api/platform', platformRoutes);
app.use('/api/about', aboutRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/vendor', requirePlatformRole('vendor'), vendorRoutes);
app.use('/api/customer', requirePlatformRole('customer'), customerRoutes);
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api/admin', requireAdmin, adminRoutes);
app.use('/api/admin/about', requireAdmin, aboutRoutes);
app.use('/api/admin/contact', requireAdmin, contactRoutes);
app.use((req,res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error,req,res,next) => {
  if (res.headersSent) return next(error);
  console.error(`Request failed: ${req.method} ${req.originalUrl}`);
  console.error(error.stack || error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({ message: error.expose ? error.message : 'The request could not be completed.' });
});
const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`Admin API listening on ${HOST}:${PORT}`);
  pool.query('SELECT 1')
    .then(() => console.log('MySQL connection verified.'))
    .catch((error) => console.error('MySQL connection unavailable at startup:', error.code || error.name));
});

server.on('error', (error) => {
  console.error('Server failed to start:', error.message);
  process.exitCode = 1;
});
