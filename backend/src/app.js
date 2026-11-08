import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { createAuthRouter } from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import platformRoutes from './routes/platform.js';
import organizerRoutes from './routes/organizer.js';
import aboutRoutes, { adminRouter as adminAboutRoutes } from './routes/about.js';
import contactRoutes, { adminRouter as adminContactRoutes } from './routes/contact.js';
import vendorRoutes from './routes/vendor.js';
import customerRoutes from './routes/customer.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { requirePlatformRole } from './middleware/requirePlatformUser.js';
import { getSystemLockState } from './lib/rbac.js';
import { formatDatabaseError, getDatabaseFailureCode, pool } from './db.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { requirePlatformAvailable } from './middleware/rbac.js';
import { loadSystemSettings, updateSystemSettingsCache } from './lib/systemSettings.js';
import adminPaymentRoutes from './routes/adminPayments.js';
import adminReviewsComplaintsRoutes from './routes/adminReviewsComplaints.js';
import adminNotificationsRoutes from './routes/adminNotifications.js';
import paymentWebhookRoutes from './routes/paymentWebhook.js';
import adminReportsRoutes from './routes/adminReports.js';
import adminAuditLogRoutes from './routes/adminAuditLogs.js';
import userAvatarRoutes from './routes/userAvatar.js';
import heroSlidesRoutes, { adminRouter as adminHeroSlidesRoutes, requireHeroSlideAdmin } from './routes/heroSlides.js';
import { requestContextMiddleware } from './lib/requestContext.js';
import { localizationMiddleware } from './lib/localization.js';
import { createAiChatRouter } from './routes/aiChat.js';

export function createApp({
  database = pool,
  emailConfigured,
  emailSender,
  emailChangeEmailConfigured,
  emailChangeEmailSender,
  emailChangeNoticeSender,
  emailChangeOtpGenerator,
  emailChangeOtpHasher,
  emailChangeOtpVerifier,
  notificationEmailConfigured,
  notificationEmailSender,
  passwordHasher,
  otpGenerator,
  otpHasher,
  otpVerifier,
  paymentProvider = null,
  aiClient = null,
  aiChatServices = {},
  heroSlidesDirectory,
} = {}) {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(localizationMiddleware);
  app.locals.database = database;
  app.locals.heroSlidesDirectory = heroSlidesDirectory;
  app.locals.passwordReset = { emailConfigured, emailSender, otpGenerator, otpHasher };
  app.locals.adminEmailChange = {
    emailConfigured: emailChangeEmailConfigured,
    emailSender: emailChangeEmailSender,
    noticeSender: emailChangeNoticeSender,
    otpGenerator: emailChangeOtpGenerator,
    otpHasher: emailChangeOtpHasher,
    otpVerifier: emailChangeOtpVerifier,
  };
  app.locals.notificationServices = {
    emailConfigured: notificationEmailConfigured,
    emailSender: notificationEmailSender,
  };
  app.locals.paymentProvider = paymentProvider;
  const configuredOrigins = (process.env.WEB_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(configuredOrigins);
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'X-Language'],
  }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !isAllowedOrigin(req.headers.origin)) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  });
  app.use('/api/payments/webhook', paymentWebhookRoutes);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/ai', requirePlatformAvailable, createAiChatRouter({ ...aiChatServices, database, client: aiClient }));
  app.get('/', (req, res) => res.json({
    status: 'ok',
    service: 'event-organizing-and-vendor-booking-api',
  }));
  app.get('/api/version', (req, res) => res.json({
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown',
    environment: process.env.NODE_ENV || 'development',
  }));
  app.get('/api/health', asyncHandler(async (_req, res) => {
    try {
      await database.query('SELECT 1');
      return res.json({ ok: true, db: true });
    } catch (error) {
      console.error('Database health check failed:', formatDatabaseError(error));
      return res.status(503).json({ ok: false, db: false, reason: getDatabaseFailureCode(error) });
    }
  }));
  app.get('/api/platform/availability', asyncHandler(async (req, res) => {
    const settings = await loadSystemSettings(database);
    updateSystemSettingsCache(app, settings);
    const platformState = getSystemLockState(settings);
    res.json({
      data: {
        platformName: settings.platform_name,
        platformDescription: settings.platform_description,
        maintenanceMode: platformState.locked,
        maintenanceMessage: settings.maintenance_message,
        publicRegistrationEnabled: settings.public_registration_enabled,
        defaultRegistrationRole: settings.default_registration_role,
        supportEmail: settings.support_email,
        supportPhone: settings.support_phone,
        brandingLogoUrl: settings.branding_logo_url,
        platformLocale: settings.platform_locale,
        platformCurrency: settings.platform_currency,
        reportTimezone: settings.report_timezone,
      },
    });
  }));
  app.use('/api/platform/organizer', requirePlatformAvailable, requirePlatformRole('organizer'), organizerRoutes);
  app.use('/api/platform', requirePlatformAvailable, platformRoutes);
  app.use('/api/hero-slides', heroSlidesRoutes);
  app.use('/api/about', requirePlatformAvailable, aboutRoutes);
  app.use('/api/contact', requirePlatformAvailable, contactRoutes);
  app.use('/api/vendor', requirePlatformAvailable, requirePlatformRole('vendor'), vendorRoutes);
  app.use('/api/customer', requirePlatformAvailable, requirePlatformRole('customer'), customerRoutes);
  app.use('/api/auth', createAuthRouter({
    database,
    emailConfigured,
    emailSender,
    passwordHasher,
    otpGenerator,
    otpHasher,
    otpVerifier,
  }));
  app.use('/api/users/me/avatar', userAvatarRoutes);
  app.use('/api/admin/about', requireAdmin, adminAboutRoutes);
  app.use('/api/admin/contact', requireAdmin, adminContactRoutes);
  app.use('/api/admin/hero-slides', requireHeroSlideAdmin, adminHeroSlidesRoutes);
  app.use('/api/admin', requireAdmin);
  app.use('/api/admin', adminAuditLogRoutes);
  app.use('/api/admin', adminPaymentRoutes);
  app.use('/api/admin/reports', adminReportsRoutes);
  app.use('/api/admin', adminReviewsComplaintsRoutes);
  app.use('/api/admin', adminNotificationsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(`Request failed: ${req.method} ${req.originalUrl}: ${formatDatabaseError(error)}`);
    console.error(error.stack || error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({ message: error.expose ? error.message : 'The request could not be completed.' });
  });

  return app;
}
