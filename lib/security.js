'use strict';
/**
 * MAX VIP — security layer
 * JWT sessions, bcrypt hashing, auth middleware, in-memory rate limiting.
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const TOKEN_TTL = '7d';
const VALID_USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;

function secret() {
  return db.get().settings.jwt_secret;
}

/** Client IP behind Vercel proxy */
function getIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : (req.socket && req.socket.remoteAddress) || '-').trim();
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, secret(), { expiresIn: TOKEN_TTL });
}

/** Require a valid Bearer token; loads fresh user; blocks banned users */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, secret());
    const user = db.get().users.find((u) => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    if (user.banned) return res.status(403).json({ error: 'This account is banned' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireOwner(req, res, next) {
  if (req.user && req.user.role === 'owner') return next();
  return res.status(403).json({ error: 'Owner access required' });
}

/* ---------------- In-memory rate limiter ---------------- */
const buckets = new Map();

function rateLimit({ windowMs = 60000, max = 10, name = 'rl' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = name + ':' + getIP(req);
    const entry = buckets.get(key);
    if (!entry || now > entry.reset) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return next();
  };
}

/* Periodic cleanup of expired buckets */
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
}, 5 * 60 * 1000);
if (cleanup.unref) cleanup.unref();

module.exports = {
  bcrypt, signToken, requireAuth, requireOwner, rateLimit, getIP, VALID_USERNAME
};