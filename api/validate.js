'use strict';
/**
 * MAX VIP — public license validation endpoint.
 * Called by your client software. No panel auth required; protected by
 * the product API key + rate limiting.
 *
 * POST /api/validate
 * Body: { "license_key": "...", "hwid": "...", "api_key": "..." }
 */
const express = require('express');
const db = require('../lib/db');
const util = require('../lib/util');
const sec = require('../lib/security');

const router = express.Router();
const validateLimit = sec.rateLimit({ windowMs: 60000, max: 120, name: 'validate' });

router.post('/', validateLimit, (req, res) => {
  const { license_key, hwid, api_key } = req.body || {};
  const data = db.get();

  const invalid = (message, extra = {}) =>
    res.json(Object.assign({ status: 'invalid', expires_at: null, message }, extra));

  /* 1. Product API key gate */
  if (!api_key || api_key !== data.settings.api_key) return invalid('Invalid API key');

  /* 2. Key lookup */
  const key = data.keys.find((k) => k.key === String(license_key || '').trim());
  if (!key) return invalid('License key not found');

  /* 3. Ban / block / expiry checks */
  if (key.status === 'banned') return invalid('License key is permanently banned', { expires_at: key.expires_at });
  if (key.status === 'blocked') {
    return invalid(key.block_reason ? `License key is blocked: ${key.block_reason}` : 'License key is blocked', { expires_at: key.expires_at });
  }
  if (util.isExpired(key)) return invalid('License key has expired', { expires_at: key.expires_at });

  /* 4. HWID binding (auto-lock on first use, respects device limit) */
  const h = String(hwid || '').trim();
  if (!h) return invalid('HWID is required');

  if (!key.hwids.includes(h)) {
    if (key.device_limit !== -1 && key.hwids.length >= key.device_limit) {
      return invalid(`Device limit reached (${key.device_limit}). Contact support for a HWID reset.`, { expires_at: key.expires_at });
    }
    key.hwids.push(h);
  }

  key.last_used = new Date().toISOString();
  db.save();

  res.json({
    status: 'valid',
    message: 'License is valid',
    expires_at: key.expires_at,
    device_limit: key.device_limit,
    devices_used: key.hwids.length,
    duration: key.duration || null
  });
});

module.exports = router;