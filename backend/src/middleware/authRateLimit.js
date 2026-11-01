import { rateLimit } from 'express-rate-limit';

export function createAuthRateLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfterSeconds = resetTime instanceof Date
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.max(1, Math.ceil(windowMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: message, retryAfterSeconds });
    },
  });
}