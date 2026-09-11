'use strict';
/**
 * MAX VIP — user management (owner only)
 * GET /api/users returns { users, logs } for the Users section.
 */
const express = require('express');
const db = require('../lib/db');
const sec = require('../lib/security');

const router = express.Router();
router.use(sec.requireAuth, sec.requireOwner);

/* List users + activity logs */
router.get('/', (req, res) => {
  const data = db.get();
  res.json({
    users: data.users.map(db.sanitizeUser),
    logs: data.logs.slice(0, 200)
  });
});

/* Edit user (username / password / role) */
router.put('/:id', (req, res) => {
  const data = db.get();
  const user = data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { username, password, role } = req.body || {};

  if (username !== undefined) {
    const uname = String(username).trim();
    if (!sec.VALID_USERNAME.test(uname)) {
      return res.status(400).json({ error: 'Username must be 3-24 characters (letters, numbers, _ . -)' });
    }
    if (data.users.some((u) => u.id !== user.id && u.username.toLowerCase() === uname.toLowerCase())) {
      return res.status(409).json({ error: 'Username is already taken' });
    }
    user.username = uname;
  }

  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    user.password = sec.bcrypt.hashSync(String(password), 10);
  }

  if (role !== undefined) {
    if (user.role === 'owner') return res.status(400).json({ error: 'The owner role cannot be changed' });
    if (!['user', 'owner'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    user.role = role;
  }

  db.save();
  db.log('user_update', req.user.username, `Updated account ${user.username}`, sec.getIP(req));
  res.json({ user: db.sanitizeUser(user) });
});

/* Ban / unban (toggle if "banned" omitted) */
router.post('/ban', (req, res) => {
  const data = db.get();
  const user = data.users.find((u) => u.id === req.body.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') return res.status(400).json({ error: 'The owner cannot be banned' });

  user.banned = req.body.banned === undefined ? !user.banned : Boolean(req.body.banned);
  db.save();
  db.log(user.banned ? 'user_ban' : 'user_unban', req.user.username,
    `${user.banned ? 'Banned' : 'Unbanned'} ${user.username}`, sec.getIP(req));
  res.json({ user: db.sanitizeUser(user) });
});

/* Delete user */
router.delete('/:id', (req, res) => {
  const data = db.get();
  const user = data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') return res.status(400).json({ error: 'The owner cannot be deleted' });

  data.users = data.users.filter((u) => u.id !== user.id);
  db.save();
  db.log('user_delete', req.user.username, `Deleted account ${user.username}`, sec.getIP(req));
  res.json({ success: true });
});

module.exports = router;