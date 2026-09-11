'use strict';
/**
 * MAX VIP — authentication + referral routes
 * POST /api/auth/login | /register | /logout   GET /api/auth/me
 * GET  /api/referral/generate | /list
 */
const express = require('express');
const db = require('../lib/db');
const util = require('../lib/util');
const sec = require('../lib/security');

const router = express.Router();
const referral = express.Router();

const loginLimit = sec.rateLimit({ windowMs: 60000, max: 8, name: 'login' });
const registerLimit = sec.rateLimit({ windowMs: 60000, max: 5, name: 'register' });

/* ---------------------------------- LOGIN --------------------------------- */
router.post('/login', loginLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const data = db.get();
  const uname = String(username).trim().toLowerCase();
  const user = data.users.find((u) => u.username.toLowerCase() === uname);

  if (!user || !sec.bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.banned) return res.status(403).json({ error: 'This account is banned' });

  user.last_login = new Date().toISOString();
  db.save();
  db.log('login', user.username, 'Signed in', sec.getIP(req));

  res.json({ token: sec.signToken(user), user: db.sanitizeUser(user) });
});

/* -------------------------------- REGISTER -------------------------------- */
router.post('/register', registerLimit, (req, res) => {
  const { username, password, referral_code } = req.body || {};
  const uname = String(username || '').trim();
  const code = String(referral_code || '').trim().toUpperCase();

  if (!sec.VALID_USERNAME.test(uname)) {
    return res.status(400).json({ error: 'Username must be 3-24 characters (letters, numbers, _ . -)' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!code) return res.status(400).json({ error: 'Referral code is required' });

  const data = db.get();
  const ref = data.referrals.find((r) => r.code.toUpperCase() === code);
  if (!ref || ref.status !== 'unused') {
    return res.status(400).json({ error: 'Invalid or already used referral code' });
  }
  if (data.users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  const user = {
    id: util.uid(),
    username: uname,
    password: sec.bcrypt.hashSync(String(password), 10),
    role: 'user',
    created_at: new Date().toISOString(),
    banned: false,
    last_login: null,
    referred_by: ref.code
  };
  data.users.push(user);

  /* Consume the referral code (single use) */
  ref.status = 'used';
  ref.used_by = uname;
  ref.used_at = new Date().toISOString();

  db.save();
  db.log('register', uname, `Registered with referral ${ref.code}`, sec.getIP(req));

  res.json({ success: true, message: 'Account created successfully. You can sign in now.' });
});

/* --------------------------------- LOGOUT --------------------------------- */
router.post('/logout', sec.requireAuth, (req, res) => {
  db.log('logout', req.user.username, 'Signed out', sec.getIP(req));
  res.json({ success: true });
});

/* ----------------------------------- ME ----------------------------------- */
router.get('/me', sec.requireAuth, (req, res) => {
  res.json({ user: db.sanitizeUser(req.user) });
});

/* ------------------------------ REFERRAL CODES ----------------------------- */
referral.get('/generate', sec.requireAuth, sec.requireOwner, (req, res) => {
  const data = db.get();
  let code;
  do { code = util.generateReferralCode(); } while (data.referrals.some((r) => r.code === code));

  const entry = {
    code,
    created_by: req.user.username,
    used_by: null,
    used_at: null,
    status: 'unused',
    created_at: new Date().toISOString()
  };
  data.referrals.push(entry);
  db.save();
  db.log('referral_create', req.user.username, `Generated referral ${code}`, sec.getIP(req));
  res.json({ referral: entry });
});

referral.get('/list', sec.requireAuth, sec.requireOwner, (req, res) => {
  res.json({ referrals: db.get().referrals.slice().reverse() });
});

module.exports = { router, referral };