'use strict';
/**
 * MAX VIP — license key management
 * Owner sees/manages all keys. Regular users manage keys they generated.
 */
const express = require('express');
const db = require('../lib/db');
const util = require('../lib/util');
const sec = require('../lib/security');

const router = express.Router();
router.use(sec.requireAuth);

const canManage = (user, key) => user.role === 'owner' || key.created_by === user.username;

function findKey(data, key) {
  return data.keys.find((k) => k.key === String(key || '').trim());
}

/* --------------------------------- LIST KEYS ------------------------------- */
router.get('/', (req, res) => {
  const data = db.get();
  let keys = data.keys.filter((k) => canManage(req.user, k));

  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').toLowerCase();
  const type = String(req.query.type || '').toLowerCase();

  if (q) {
    keys = keys.filter((k) =>
      k.key.toLowerCase().includes(q) ||
      (k.notes || '').toLowerCase().includes(q) ||
      (k.assigned_to || '').toLowerCase().includes(q));
  }
  if (type === 'standard' || type === 'custom') keys = keys.filter((k) => k.type === type);
  if (['active', 'expired', 'blocked', 'banned'].includes(status)) {
    keys = keys.filter((k) => util.effectiveStatus(k) === status);
  }

  keys.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ keys });
});

/* ------------------------------ STANDARD KEYGEN ---------------------------- */
router.post('/generate', (req, res) => {
  const { duration = '30d', device_limit = 1, amount = 1 } = req.body || {};

  if (!(duration in util.DURATIONS)) {
    return res.status(400).json({ error: 'Invalid duration. Use 1d, 7d, 30d, 90d, 365d or lifetime' });
  }
  const limit = Number(device_limit);
  if (!util.DEVICE_LIMITS.includes(limit)) {
    return res.status(400).json({ error: 'Device limit must be 1, 2, 3 or -1 (unlimited)' });
  }
  const count = Math.max(1, Math.min(100, parseInt(amount, 10) || 1));

  const data = db.get();
  const created = [];
  for (let i = 0; i < count; i++) {
    let key;
    do { key = util.generateLicenseKey(); } while (data.keys.some((k) => k.key === key));
    const entry = {
      key,
      type: 'standard',
      duration,
      created_by: req.user.username,
      assigned_to: null,
      hwids: [],
      device_limit: limit,
      status: 'active',
      expires_at: util.expiryFromDuration(duration),
      created_at: new Date().toISOString(),
      last_used: null,
      notes: '',
      block_reason: null
    };
    data.keys.push(entry);
    created.push(entry);
  }
  db.save();
  db.log('key_generate', req.user.username,
    `Generated ${count} key(s) · ${duration} · ${limit === -1 ? 'unlimited' : limit} device(s)`, sec.getIP(req));

  res.json({ keys: created });
});

/* -------------------------------- CUSTOM KEYGEN ---------------------------- */
router.post('/custom', (req, res) => {
  const { key, duration = '30d', device_limit = 1, notes = '' } = req.body || {};
  const custom = String(key || '').trim();

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(custom)) {
    return res.status(400).json({ error: 'Custom key must be 8-64 characters: letters, numbers, dashes, underscores' });
  }
  if (!(duration in util.DURATIONS)) {
    return res.status(400).json({ error: 'Invalid duration. Use 1d, 7d, 30d, 90d, 365d or lifetime' });
  }
  const limit = Number(device_limit);
  if (!util.DEVICE_LIMITS.includes(limit)) {
    return res.status(400).json({ error: 'Device limit must be 1, 2, 3 or -1 (unlimited)' });
  }

  const data = db.get();
  if (data.keys.some((k) => k.key.toLowerCase() === custom.toLowerCase())) {
    return res.status(409).json({ error: 'This key already exists' });
  }

  const entry = {
    key: custom,
    type: 'custom',
    duration,
    created_by: req.user.username,
    assigned_to: null,
    hwids: [],
    device_limit: limit,
    status: 'active',
    expires_at: util.expiryFromDuration(duration),
    created_at: new Date().toISOString(),
    last_used: null,
    notes: String(notes || '').slice(0, 300),
    block_reason: null
  };
  data.keys.push(entry);
  db.save();
  db.log('key_custom', req.user.username, `Created custom key ${custom}`, sec.getIP(req));
  res.json({ key: entry });
});

/* ------------------------------ BLOCK / BAN / UNBLOCK ---------------------- */
router.post('/block', (req, res) => {
  const data = db.get();
  const key = findKey(data, req.body.key);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  if (!canManage(req.user, key)) return res.status(403).json({ error: 'Not allowed' });

  key.status = 'blocked';
  key.block_reason = String(req.body.reason || 'Blocked by staff').slice(0, 200);
  db.save();
  db.log('key_block', req.user.username, `Blocked ${key.key}`, sec.getIP(req));
  res.json({ key });
});

router.post('/ban', (req, res) => {
  const data = db.get();
  const key = findKey(data, req.body.key);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  if (!canManage(req.user, key)) return res.status(403).json({ error: 'Not allowed' });

  key.status = 'banned';
  key.block_reason = String(req.body.reason || 'Permanently banned').slice(0, 200);
  db.save();
  db.log('key_ban', req.user.username, `Banned ${key.key}`, sec.getIP(req));
  res.json({ key });
});

router.post('/unblock', (req, res) => {
  const data = db.get();
  const key = findKey(data, req.body.key);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  if (!canManage(req.user, key)) return res.status(403).json({ error: 'Not allowed' });

  key.status = 'active';
  key.block_reason = null;
  db.save();
  db.log('key_unblock', req.user.username, `Unblocked ${key.key}`, sec.getIP(req));
  res.json({ key });
});

/* --------------------------------- RESET HWID ------------------------------ */
router.post('/reset-hwid', (req, res) => {
  const data = db.get();
  const key = findKey(data, req.body.key);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  if (!canManage(req.user, key)) return res.status(403).json({ error: 'Not allowed' });

  key.hwids = [];
  db.save();
  db.log('hwid_reset', req.user.username, `Reset HWID for ${key.key}`, sec.getIP(req));
  res.json({ key });
});

/* ---------------------------------- DELETE --------------------------------- */
router.delete('/:key', (req, res) => {
  const data = db.get();
  const key = findKey(data, req.params.key);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  if (!canManage(req.user, key)) return res.status(403).json({ error: 'Not allowed' });

  data.keys = data.keys.filter((k) => k.key !== key.key);
  db.save();
  db.log('key_delete', req.user.username, `Deleted ${key.key}`, sec.getIP(req));
  res.json({ success: true });
});

module.exports = router;