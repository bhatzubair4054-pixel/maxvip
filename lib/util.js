'use strict';
/**
 * MAX VIP — utility helpers
 * Key generation, durations, expiry math, CSV helpers.
 */
const crypto = require('crypto');

/* Unambiguous charset (no 0/O, 1/I) */
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* duration id -> days (0 = lifetime) */
const DURATIONS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365, lifetime: 0 };

/* Allowed device limits (-1 = unlimited) */
const DEVICE_LIMITS = [1, 2, 3, -1];

/** Random string using crypto RNG */
function rand(length, chars = KEY_CHARS) {
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

/** Standard key: XXXX-XXXX-XXXX-XXXX-XXXX */
function generateLicenseKey() {
  return Array.from({ length: 5 }, () => rand(5)).join('-');
}

/** One-time referral code */
function generateReferralCode() {
  return 'MAX-' + rand(6);
}

/** Product API key used by client software on /api/validate */
function generateApiKey() {
  return 'mxv_live_' + crypto.randomBytes(18).toString('base64url');
}

/** Random hex secret (JWT) */
function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Short unique id */
function uid() {
  return crypto.randomBytes(6).toString('hex');
}

/** duration id -> ISO expiry (null = lifetime) */
function expiryFromDuration(duration) {
  const days = DURATIONS[duration];
  if (!days) return null;
  return new Date(Date.now() + days * 86400000).toISOString();
}

function isExpired(key) {
  return Boolean(key.expires_at && new Date(key.expires_at).getTime() < Date.now());
}

/** Effective status: stored block/ban wins, then expiry */
function effectiveStatus(key) {
  if (key.status === 'blocked' || key.status === 'banned') return key.status;
  return isExpired(key) ? 'expired' : 'active';
}

function csvEscape(value) {
  const v = String(value ?? '');
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function toCSV(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  return lines.join('\n');
}

module.exports = {
  DURATIONS, DEVICE_LIMITS,
  rand, generateLicenseKey, generateReferralCode, generateApiKey, generateSecret,
  uid, expiryFromDuration, isExpired, effectiveStatus, toCSV, csvEscape
};