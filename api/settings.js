'use strict';
/**
 * MAX VIP — account & panel settings
 * POST /api/settings/username | /password
 * GET  /api/settings/apikey   POST /api/settings/apikey/regenerate (owner)
 */
const express = require('express');
const db = require('../lib/db');
const util = require('../lib/util');
const sec = require('../lib/security');

const router = express.Router();
router.use(sec.requireAuth);

/* Change own username (returns a refreshed token) */
router.post('/username', (req, res) => {
  const uname = String((req.body || {}).username || '').trim();
  if (!sec.VALID_USERNAME.test(uname)) {
    return res.status(400).json({ error: 'Username must be 3-24 characters (letters, numbers, _ . -)' });
  }
  const data = db.get();
  if (data.users.some((u) => u.id !== req.user.id && u.username.toLowerCase() === uname.toLowerCase())) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  const old = req.user.username;
  req.user.username = uname;
  db.save();
  db.log('settings_username', uname, `Username changed from ${old}`, sec.getIP(req));
  res.json({ success: true, user: db.sanitizeUser(req.user), token: sec.signToken(req.user) });
});

/* Change own password (requires current password) */
router.post('/password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (!sec.bcrypt.compareSync(String(current_password), req.user.password)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  req.user.password = sec.bcrypt.hashSync(String(new_password), 10);
  db.save();
  db.log('settings_password', req.user.username, 'Password changed', sec.getIP(req));
  res.json({ success: true });
});

/* View product API key (owner) */
router.get('/apikey', sec.requireOwner, (req, res) => {
  res.json({ api_key: db.get().settings.api_key });
});

/* Regenerate product API key (owner) */
router.post('/apikey/regenerate', sec.requireOwner, (req, res) => {
  const data = db.get();
  data.settings.api_key = util.generateApiKey();
  db.save();
  db.log('apikey_regenerate', req.user.username, 'Product API key regenerated', sec.getIP(req));
  res.json({ api_key: data.settings.api_key });
});

module.exports = router;