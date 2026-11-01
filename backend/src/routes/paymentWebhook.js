import { Router } from 'express';
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { pool } from '../db.js';
import { processVerifiedProviderEvent } from '../lib/paymentManagement.js';

const router = Router();
const databaseFor = (req) => req.app?.locals?.database || pool;

router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), asyncHandler(async (req, res) => {
  const provider = req.app.locals.paymentProvider;
  if (!provider || typeof provider.verifyWebhook !== 'function') {
    return res.status(503).json({ error: 'Payment provider integration is not configured.' });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: 'A provider-signed JSON webhook body is required.' });
  }

  let verifiedEvent;
  try {
    verifiedEvent = await provider.verifyWebhook({
      headers: req.headers,
      rawBody: req.body,
    });
  } catch {
    console.error('Payment provider webhook verification failed due to an adapter error.');
    return res.status(503).json({ error: 'Provider webhook verification is temporarily unavailable.' });
  }
  if (!verifiedEvent) return res.status(401).json({ error: 'Provider webhook verification failed.' });

  const result = await processVerifiedProviderEvent(databaseFor(req), provider, verifiedEvent);
  res.json({ data: result });
}));

export default router;
