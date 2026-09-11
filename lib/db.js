'use strict';
/**
 * MAX VIP — JSON file storage engine.
 * - Locally:        ./data/db.json
 * - On Vercel:      /tmp/maxvip/db.json (serverless writable dir)
 *
 * NOTE: Vercel /tmp is ephemeral. See README "Data persistence" for
 * production upgrade path (Vercel KV / Blob / external DB).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const util = require('./util');

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? '/tmp/maxvip' : path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'db.json');

/* Owner account (auto-seeded on first boot) */
const OWNER_USERNAME = 'bhatzubair4054';
const OWNER_PASSWORD = 'Bhat@123';

let db = null; // in-memory cache

function blank() {
  return { users: [], keys: [], referrals: [], logs: [], settings: {} };
}

function readFromDisk() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return Object.assign(blank(), JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Atomic write: tmp file + rename */
function writeToDisk() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/** Ensure owner account + API key + JWT secret exist */
function seed() {
  let changed = false;
  if (!db.users.some((u) => u.role === 'owner')) {
    db.users.push({
      id: util.uid(),
      username: OWNER_USERNAME,
      password: bcrypt.hashSync(OWNER_PASSWORD, 10),
      role: 'owner',
      created_at: new Date().toISOString(),
      banned: false,
      last_login: null,
      referred_by: null
    });
    changed = true;
  }
  if (!db.settings.api_key) { db.settings.api_key = util.generateApiKey(); changed = true; }
  if (!db.settings.jwt_secret) { db.settings.jwt_secret = util.generateSecret(); changed = true; }
  if (changed) writeToDisk();
}

/** Get the database (loads + seeds on first access) */
function get() {
  if (!db) {
    db = readFromDisk() || blank();
    seed();
  }
  return db;
}

function save() {
  writeToDisk();
}

/** Append an activity log entry (capped at 1000) */
function log(action, user, details, ip) {
  const data = get();
  data.logs.unshift({
    id: util.uid(),
    action,
    user,
    details,
    ip: ip || '-',
    timestamp: new Date().toISOString()
  });
  if (data.logs.length > 1000) data.logs.length = 1000;
  save();
}

/** Strip secrets before sending a user object to the client */
function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

module.exports = { get, save, log, sanitizeUser, DB_FILE };