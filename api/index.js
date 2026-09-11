'use strict';
/**
 * MAX VIP — Express application root.
 * Vercel routes /api/* here via vercel.json rewrites.
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

/* Security headers (CSP disabled: frontend uses Google Fonts + same-origin scripts) */
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false }));

/* CORS — restrict with CORS_ORIGIN env var in production if desired */
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));

app.use(express.json({ limit: '1mb' }));

/* Health check */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'MAX VIP', time: new Date().toISOString() });
});

/* Routers */
const auth = require('./auth');
app.use('/api/auth', auth.router);
app.use('/api/referral', auth.referral);
app.use('/api/keys', require('./keys'));
app.use('/api/users', require('./users'));
app.use('/api/validate', require('./validate'));
app.use('/api/settings', require('./settings'));

/* Unknown API route */
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

/* Error handler */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[MAX VIP]', err.message);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  return res.status(500).json({ error: 'Internal server error' });
});

/* Static files for local dev — on Vercel these are served via rewrites from /public */
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, '..', 'public')));
}

module.exports = app;