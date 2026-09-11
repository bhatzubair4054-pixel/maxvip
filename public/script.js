'use strict';
/* ============================================================
   MAX VIP — frontend logic (vanilla JS)
   Handles auth, dashboard, keys, users, settings.
   ============================================================ */

/* ---------------- State & helpers ---------------- */
const App = {
  token: localStorage.getItem('mxv_token') || null,
  user: JSON.parse(localStorage.getItem('mxv_user') || 'null'),
  clearSession() {
    App.token = null; App.user = null;
    localStorage.removeItem('mxv_token');
    localStorage.removeItem('mxv_user');
  }
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (App.token) headers.Authorization = 'Bearer ' + App.token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !['/api/auth/login', '/api/auth/register'].includes(path)) {
    App.clearSession();
    location.replace('index.html');
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}

function toast(msg, type = 'success') {
  const root = $('#toastRoot');
  if (!root) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.innerHTML = '<span class="toast-dot"></span><span>' + esc(msg) + '</span>';
  root.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3400);
}

async function copyText(text, msg = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg, 'info');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg, 'info'); } catch { toast('Copy failed', 'error'); }
    ta.remove();
  }
}

/* ---------------- Formatters ---------------- */
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtExpiry = (k) => k.expires_at ? fmtDate(k.expires_at) : 'Lifetime';
const fmtLimit = (k) => k.device_limit === -1 ? k.hwids.length + ' / Unlimited' : k.hwids.length + ' / ' + k.device_limit;

function keyStatus(k) {
  if (k.status === 'blocked') return 'blocked';
  if (k.status === 'banned') return 'banned';
  if (k.expires_at && new Date(k.expires_at) < new Date()) return 'expired';
  return 'active';
}
const STATUS_LABEL = { active: 'Active', expired: 'Expired', blocked: 'Blocked', banned: 'Banned', unused: 'Unused', used: 'Used' };
const badge = (s) => '<span class="badge b-' + s + '">' + (STATUS_LABEL[s] || s) + '</span>';

/* ---------------- Icons ---------------- */
const I = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
};

/* ---------------- Confirm dialog (promise based) ---------------- */
let pendingConfirm = null;

function setupConfirm() {
  const overlay = $('#confirmModal');
  if (!overlay) return;
  const finish = (ok) => {
    const cb = pendingConfirm; pendingConfirm = null;
    overlay.classList.remove('open');
    if (cb) cb({ ok, reason: ($('#confirmReason') ? $('#confirmReason').value : '').trim() });
  };
  $('#confirmOk').addEventListener('click', () => finish(true));
  $('#confirmCancel').addEventListener('click', () => finish(false));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
}

function confirmDialog({ title, text = '', okLabel = 'Confirm', reason = false }) {
  if (pendingConfirm) pendingConfirm({ ok: false, reason: '' });
  return new Promise((resolve) => {
    pendingConfirm = resolve;
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel;
    $('#confirmReasonWrap').hidden = !reason;
    if ($('#confirmReason')) $('#confirmReason').value = '';
    $('#confirmModal').classList.add('open');
  });
}

/* ---------------- Modals & shared bindings ---------------- */
function openModal(sel) { $(sel).classList.add('open'); }
function closeModalEl(el) { const o = el.closest('.modal-overlay'); if (o) o.classList.remove('open'); }

function bindGlobal() {
  /* Modal close buttons + backdrop */
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) closeModalEl(closer);
  });

  /* Password visibility toggles */
  $$('[data-eye]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.eye);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  /* Sidebar (mobile) */
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebarBackdrop');
  const toggle = $('#navToggle');
  if (sidebar && toggle) {
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('open');
      if (backdrop) backdrop.hidden = !open;
    });
  }
  if (backdrop) backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.hidden = true;
  });

  /* Logout */
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
      App.clearSession();
      location.replace('index.html');
    });
  }

  /* Topbar date chip */
  const dateChip = $('#topDate');
  if (dateChip) {
    dateChip.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  setupConfirm();
}

function renderShell() {
  const u = App.user;
  if (!u) return;
  const name = $('#sideName'); if (name) name.textContent = u.username;
  const role = $('#sideRole'); if (role) role.textContent = u.role;
  const av = $('#sideAvatar'); if (av) av.textContent = u.username.charAt(0).toUpperCase();
  $$('[data-owner-only]').forEach((el) => { el.hidden = u.role !== 'owner'; });
}

/* ============================================================
   LOGIN
   ============================================================ */
function showLoading(text) {
  const el = $('#authLoading');
  if (!el) return;
  if (text) { const t = $('#authLoadingText'); if (t) t.textContent = text; }
  el.hidden = false;
}
function hideLoading() { const el = $('#authLoading'); if (el) el.hidden = true; }

function initLogin() {
  const form = $('#loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#loginError');
    errEl.hidden = true;
    const username = $('#liUser').value.trim();
    const password = $('#liPass').value;
    if (!username || !password) {
      errEl.textContent = 'Enter your username and password.';
      errEl.hidden = false;
      return;
    }
    showLoading('Authenticating...');
    const started = Date.now();
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
      const wait = Math.max(0, 900 - (Date.now() - started)); // keep spinner visible briefly
      setTimeout(() => {
        App.token = data.token; App.user = data.user;
        localStorage.setItem('mxv_token', data.token);
        localStorage.setItem('mxv_user', JSON.stringify(data.user));
        location.replace('dashboard.html');
      }, wait);
    } catch (err) {
      const wait = Math.max(0, 650 - (Date.now() - started));
      setTimeout(() => {
        hideLoading();
        errEl.textContent = err.message;
        errEl.hidden = false;
      }, wait);
    }
  });
}

/* ============================================================
   REGISTER
   ============================================================ */
function initRegister() {
  const form = $('#registerForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#registerError');
    errEl.hidden = true;
    const username = $('#ruUser').value.trim();
    const password = $('#ruPass').value;
    const password2 = $('#ruPass2').value;
    const referral = $('#ruRef').value.trim();

    if (!username || !password || !referral) return showErr('All fields are required.');
    if (password.length < 6) return showErr('Password must be at least 6 characters.');
    if (password !== password2) return showErr('Passwords do not match.');

    showLoading('Creating account...');
    try {
      await api('/api/auth/register', { method: 'POST', body: { username, password, referral_code: referral } });
      setTimeout(() => location.replace('index.html'), 1100);
    } catch (err) {
      hideLoading();
      showErr(err.message);
    }

    function showErr(msg) { errEl.textContent = msg; errEl.hidden = false; }
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function initDashboard() {
  const isOwner = App.user.role === 'owner';
  const grid = $('#statsGrid');

  try {
    const [{ keys }, referrals, usersData] = await Promise.all([
      api('/api/keys'),
      isOwner ? api('/api/referral/list') : Promise.resolve({ referrals: [] }),
      isOwner ? api('/api/users') : Promise.resolve({ users: [], logs: [] })
    ]);

    /* --- Stats --- */
    const counts = { total: keys.length, active: 0, expired: 0, blocked: 0, banned: 0 };
    keys.forEach((k) => { counts[keyStatus(k)]++; });

    const statCard = (cls, icon, num, label) =>
      '<div class="glass stat rgb-hover"><div class="stat-icon ' + cls + '">' + icon + '</div>' +
      '<div><div class="stat-num">' + num + '</div><div class="stat-label">' + label + '</div></div></div>';

    const svgKey = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="16" r="3.5"/><path d="M10.5 13.5 20 4m-4.5.5L19 8"/></svg>';
    const svgCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m4 12.5 5 5L20 6.5"/></svg>';
    const svgClock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    const svgBlock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
    const svgUsers = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/></svg>';
    const svgTicket = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v3a2 2 0 0 0 0 2v3a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-2Z"/><path d="M13 6v12" stroke-dasharray="2.5 3"/></svg>';

    let html = '';
    html += statCard('si-pink', svgKey, counts.total, 'Total Keys');
    html += statCard('si-green', svgCheck, counts.active, 'Active');
    html += statCard('si-amber', svgClock, counts.expired, 'Expired');
    html += statCard('si-blue', svgBlock, counts.blocked, 'Blocked');
    html += statCard('si-red', svgBlock, counts.banned, 'Banned');
    if (isOwner) {
      html += statCard('si-purple', svgUsers, usersData.users.length, 'Users');
      html += statCard('si-teal', svgTicket, referrals.referrals.filter((r) => r.status === 'unused').length, 'Unused Referrals');
    }
    grid.innerHTML = html;

    /* --- Referral panel (owner) --- */
    if (isOwner) {
      renderReferrals(referrals.referrals);
      $('#refGenBtn').addEventListener('click', async () => {
        try {
          const { referral } = await api('/api/referral/generate');
          toast('Referral code ' + referral.code + ' created');
          renderReferrals([referral, ...referrals.referrals]);
          referrals.referrals.unshift(referral);
        } catch (err) { toast(err.message, 'error'); }
      });
      $('#refBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-copy-code]');
        if (btn) copyText(btn.dataset.copyCode, 'Referral code copied');
      });

      /* --- Recent activity (owner) --- */
      $('#recentTitle').textContent = 'Recent Activity';
      const logs = usersData.logs.slice(0, 8);
      $('#recentBody').innerHTML = logs.length
        ? '<table class="table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>' +
          logs.map((l) => '<tr><td class="muted">' + fmtDate(l.timestamp) + '</td><td>' + esc(l.user) + '</td><td><span class="tag">' + esc(l.action) + '</span></td><td class="muted">' + esc(l.details) + '</td></tr>').join('') +
          '</tbody></table>'
        : '<div class="empty"><p>No activity yet</p><span>Actions across the panel will appear here.</span></div>';
    } else {
      /* --- Recent keys (member) --- */
      $('#recentTitle').textContent = 'Your Recent Keys';
      const recent = keys.slice(0, 5);
      $('#recentBody').innerHTML = recent.length
        ? '<table class="table"><thead><tr><th>Key</th><th>Expires</th><th>Status</th></tr></thead><tbody>' +
          recent.map((k) => '<tr><td class="key-cell">' + esc(k.key) + '</td><td>' + esc(fmtExpiry(k)) + '</td><td>' + badge(keyStatus(k)) + '</td></tr>').join('') +
          '</tbody></table>'
        : '<div class="empty"><p>No keys yet</p><span>Generate your first key from the License Keys page.</span></div>';
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderReferrals(list) {
  const body = $('#refBody');
  if (!body) return;
  body.innerHTML = list.length
    ? list.map((r) =>
        '<tr><td class="key-cell">' + esc(r.code) + '</td><td>' + badge(r.status) + '</td><td class="muted">' +
        esc(r.used_by || '—') + '</td><td class="muted">' + fmtDate(r.created_at) + '</td>' +
        '<td><div class="actions-cell"><button class="icon-btn" title="Copy code" data-copy-code="' + esc(r.code) + '">' + I.copy + '</button></div></td></tr>'
      ).join('')
    : '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">No referral codes yet. Generate one to invite users.</td></tr>';
}

/* ============================================================
   KEYS
   ============================================================ */
let allKeys = [];

function filteredKeys() {
  const q = ($('#keySearch') ? $('#keySearch').value : '').trim().toLowerCase();
  const status = $('#statusFilter') ? $('#statusFilter').value : '';
  const type = $('#typeFilter') ? $('#typeFilter').value : '';
  return allKeys.filter((k) => {
    if (status && keyStatus(k) !== status) return false;
    if (type && k.type !== type) return false;
    if (q && !(k.key.toLowerCase().includes(q) || (k.notes || '').toLowerCase().includes(q) || (k.assigned_to || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderKeysTable() {
  const body = $('#keysBody');
  const list = filteredKeys();
  $('#keyCount').textContent = list.length + ' key' + (list.length === 1 ? '' : 's');
  $('#keysEmpty').hidden = list.length > 0;

  body.innerHTML = list.map((k) => {
    const s = keyStatus(k);
    const actions =
      '<button class="icon-btn" title="Copy key" data-action="copy" data-key="' + esc(k.key) + '">' + I.copy + '</button>' +
      '<button class="icon-btn teal" title="Bound devices" data-action="devices" data-key="' + esc(k.key) + '">' + I.device + '</button>' +
      (s === 'blocked' || s === 'banned'
        ? '<button class="icon-btn" title="Unblock" data-action="unblock" data-key="' + esc(k.key) + '">' + I.unlock + '</button>'
        : '<button class="icon-btn amber" title="Block" data-action="block" data-key="' + esc(k.key) + '">' + I.ban + '</button>') +
      (s !== 'banned' ? '<button class="icon-btn red" title="Ban permanently" data-action="ban" data-key="' + esc(k.key) + '">' + I.ban + '</button>' : '') +
      '<button class="icon-btn red" title="Delete" data-action="delete" data-key="' + esc(k.key) + '">' + I.trash + '</button>';

    return '<tr>' +
      '<td><span class="key-cell">' + esc(k.key) + '</span>' + (k.notes ? '<span class="cell-note">' + esc(k.notes) + '</span>' : '') + '</td>' +
      '<td><span class="tag">' + (k.type === 'custom' ? 'Custom' : 'Standard') + '</span></td>' +
      '<td>' + (k.expires_at ? esc(fmtExpiry(k)) : '<span style="color:var(--accent-2);font-weight:600">Lifetime</span>') + '</td>' +
      '<td><button class="chip-link" data-action="devices" data-key="' + esc(k.key) + '">' + esc(fmtLimit(k)) + '</button></td>' +
      '<td>' + badge(s) + '</td>' +
      '<td class="muted">' + fmtDate(k.created_at) + '</td>' +
      '<td><div class="actions-cell">' + actions + '</div></td>' +
      '</tr>';
  }).join('');
}

async function loadKeys() {
  try {
    const { keys } = await api('/api/keys');
    allKeys = keys;
    renderKeysTable();
  } catch (err) { toast(err.message, 'error'); }
}

function openDevices(k) {
  $('#deviceKey').textContent = k.key;
  $('#deviceList').innerHTML = k.hwids.length
    ? k.hwids.map((h) => '<div class="result-row"><span>' + esc(h) + '</span><button class="icon-btn" title="Copy HWID" data-copy-hwid="' + esc(h) + '">' + I.copy + '</button></div>').join('')
    : '<div class="empty" style="padding:22px"><p>No devices bound</p><span>The HWID locks automatically on first validation.</span></div>';
  $('#resetHwidBtn').dataset.key = k.key;
  openModal('#deviceModal');
}

async function initKeys() {
  await loadKeys();

  /* Filters */
  let debounce = null;
  $('#keySearch').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(renderKeysTable, 180); });
  $('#statusFilter').addEventListener('change', renderKeysTable);
  $('#typeFilter').addEventListener('change', renderKeysTable);

  /* Generate modal: tabs */
  $$('#genModal .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('#genModal .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $('#standardForm').hidden = tab.dataset.tab !== 'standard';
      $('#customForm').hidden = tab.dataset.tab !== 'custom';
    });
  });

  $('#newKeyBtn').addEventListener('click', () => {
    $('#genResults').hidden = true;
    $('#resultList').innerHTML = '';
    openModal('#genModal');
  });

  /* Standard generation */
  $('#standardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('/api/keys/generate', {
        method: 'POST',
        body: {
          duration: $('#genDuration').value,
          device_limit: Number($('#genDevices').value),
          amount: Number($('#genAmount').value) || 1
        }
      });
      showResults(data.keys.map((k) => k.key));
      toast(data.keys.length + ' key(s) generated');
      loadKeys();
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  /* Custom generation */
  $('#customForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('/api/keys/custom', {
        method: 'POST',
        body: {
          key: $('#customKey').value.trim(),
          duration: $('#customDuration').value,
          device_limit: Number($('#customDevices').value),
          notes: $('#customNotes').value.trim()
        }
      });
      showResults([data.key.key]);
      toast('Custom key created');
      $('#customKey').value = ''; $('#customNotes').value = '';
      loadKeys();
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  function showResults(list) {
    $('#genResults').hidden = false;
    $('#resultList').innerHTML = list.map((k) =>
      '<div class="result-row"><span>' + esc(k) + '</span><button class="icon-btn" title="Copy" data-copy-gen="' + esc(k) + '">' + I.copy + '</button></div>'
    ).join('');
    $('#copyAllBtn').dataset.keys = list.join('\n');
  }

  $('#copyAllBtn').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.keys) copyText(e.currentTarget.dataset.keys, 'All keys copied');
  });

  /* Result + device copy buttons */
  $('#genModal').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-gen]');
    if (btn) copyText(btn.dataset.copyGen, 'Key copied');
  });
  $('#deviceModal').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-hwid]');
    if (btn) copyText(btn.dataset.copyHwid, 'HWID copied');
  });

  /* HWID reset */
  $('#resetHwidBtn').addEventListener('click', async (e) => {
    const key = e.currentTarget.dataset.key;
    const r = await confirmDialog({ title: 'Reset HWID?', text: key + ' will be unbound from all devices.', okLabel: 'Reset' });
    if (!r.ok) return;
    try {
      await api('/api/keys/reset-hwid', { method: 'POST', body: { key } });
      toast('HWID reset — key can be bound again');
      $('#deviceModal').classList.remove('open');
      loadKeys();
    } catch (err) { toast(err.message, 'error'); }
  });

  /* Row actions */
  $('#keysBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const key = btn.dataset.key;
    const action = btn.dataset.action;
    const k = allKeys.find((x) => x.key === key);
    if (!k) return;

    try {
      switch (action) {
        case 'copy':
          return copyText(k.key, 'Key copied to clipboard');
        case 'devices':
          return openDevices(k);
        case 'block': {
          const r = await confirmDialog({ title: 'Block this key?', text: key + ' will stop validating until unblocked.', okLabel: 'Block', reason: true });
          if (!r.ok) return;
          await api('/api/keys/block', { method: 'POST', body: { key, reason: r.reason } });
          toast('Key blocked', 'info');
          return loadKeys();
        }
        case 'ban': {
          const r = await confirmDialog({ title: 'Ban this key permanently?', text: key + ' can never validate again.', okLabel: 'Ban', reason: true });
          if (!r.ok) return;
          await api('/api/keys/ban', { method: 'POST', body: { key, reason: r.reason } });
          toast('Key banned', 'error');
          return loadKeys();
        }
        case 'unblock':
          await api('/api/keys/unblock', { method: 'POST', body: { key } });
          toast('Key restored');
          return loadKeys();
        case 'delete': {
          const r = await confirmDialog({ title: 'Delete this key?', text: key + ' will be permanently removed.', okLabel: 'Delete' });
          if (!r.ok) return;
          await api('/api/keys/' + encodeURIComponent(key), { method: 'DELETE' });
          toast('Key deleted');
          return loadKeys();
        }
      }
    } catch (err) { toast(err.message, 'error'); }
  });

  /* Export TXT / CSV (client-side from current filtered view) */
  $('#exportTxt').addEventListener('click', () => {
    const list = filteredKeys();
    if (!list.length) return toast('Nothing to export', 'info');
    const txt = list.map((k) => k.key + ' | ' + keyStatus(k) + ' | expires: ' + (k.expires_at || 'lifetime')).join('\n');
    download('maxvip-keys.txt', txt, 'text/plain');
  });

  $('#exportCsv').addEventListener('click', () => {
    const list = filteredKeys();
    if (!list.length) return toast('Nothing to export', 'info');
    const headers = ['key', 'type', 'status', 'expires_at', 'device_limit', 'devices_bound', 'created_at', 'notes'];
    const rows = list.map((k) => ({
      key: k.key, type: k.type, status: keyStatus(k), expires_at: k.expires_at || 'lifetime',
      device_limit: k.device_limit, devices_bound: k.hwids.join('; '), created_at: k.created_at, notes: k.notes || ''
    }));
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => '"' + String(r[h]).replace(/"/g, '""') + '"').join(','))].join('\n');
    download('maxvip-keys.csv', csv, 'text/csv');
  });
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   USERS (owner)
   ============================================================ */
async function initUsers() {
  await loadUsers();
  $('#logsRefresh').addEventListener('click', loadUsers);

  /* Edit modal submit */
  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#editUserId').value;
    const body = { username: $('#euName').value.trim() };
    if ($('#euPass').value) body.password = $('#euPass').value;
    if (!$('#euRole').disabled) body.role = $('#euRole').value;
    try {
      await api('/api/users/' + id, { method: 'PUT', body });
      toast('User updated');
      $('#editModal').classList.remove('open');
      loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  });

  /* Row actions */
  $('#usersBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const u = (window.__users || []).find((x) => x.id === id);
    if (!u) return;

    try {
      if (action === 'edit') {
        $('#editUserId').value = u.id;
        $('#euName').value = u.username;
        $('#euPass').value = '';
        $('#euRole').value = u.role;
        $('#euRole').disabled = u.role === 'owner';
        openModal('#editModal');
      } else if (action === 'ban') {
        const r = await confirmDialog({
          title: u.banned ? 'Unban this user?' : 'Ban this user?',
          text: u.username + (u.banned ? ' will regain access.' : ' will lose access immediately.'),
          okLabel: u.banned ? 'Unban' : 'Ban'
        });
        if (!r.ok) return;
        await api('/api/users/ban', { method: 'POST', body: { id, banned: !u.banned } });
        toast(u.banned ? 'User unbanned' : 'User banned', 'info');
        loadUsers();
      } else if (action === 'delete') {
        const r = await confirmDialog({ title: 'Delete this user?', text: u.username + ' will be permanently removed.', okLabel: 'Delete' });
        if (!r.ok) return;
        await api('/api/users/' + id, { method: 'DELETE' });
        toast('User deleted');
        loadUsers();
      }
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadUsers() {
  try {
    const data = await api('/api/users');
    window.__users = data.users;

    $('#userCount').textContent = data.users.length + ' account' + (data.users.length === 1 ? '' : 's');
    $('#usersBody').innerHTML = data.users.map((u) => {
      const isOwner = u.role === 'owner';
      const actions = isOwner
        ? '<span class="icon-btn" title="Owner account is protected" style="cursor:default;opacity:.5">' + I.lock + '</span>'
        : '<button class="icon-btn" title="Edit" data-action="edit" data-id="' + u.id + '">' + I.edit + '</button>' +
          '<button class="icon-btn ' + (u.banned ? 'teal' : 'amber') + '" title="' + (u.banned ? 'Unban' : 'Ban') + '" data-action="ban" data-id="' + u.id + '">' + I.ban + '</button>' +
          '<button class="icon-btn red" title="Delete" data-action="delete" data-id="' + u.id + '">' + I.trash + '</button>';

      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="width:30px;height:30px;font-size:12px;border-radius:9px">' + esc(u.username.charAt(0).toUpperCase()) + '</div><span style="font-weight:600">' + esc(u.username) + '</span></div></td>' +
        '<td><span class="badge b-' + u.role + '">' + u.role + '</span></td>' +
        '<td class="muted">' + esc(u.referred_by || '—') + '</td>' +
        '<td class="muted">' + fmtDate(u.created_at) + '</td>' +
        '<td class="muted">' + fmtDate(u.last_login) + '</td>' +
        '<td>' + (u.banned ? '<span class="badge b-banned">Banned</span>' : '<span class="badge b-active">Active</span>') + '</td>' +
        '<td><div class="actions-cell">' + actions + '</div></td>' +
        '</tr>';
    }).join('');

    $('#logsBody').innerHTML = data.logs.length
      ? data.logs.slice(0, 100).map((l) =>
          '<tr><td class="muted" style="white-space:nowrap">' + fmtDate(l.timestamp) + '</td><td>' + esc(l.user) +
          '</td><td><span class="tag">' + esc(l.action) + '</span></td><td class="muted">' + esc(l.details) +
          '</td><td class="muted mono">' + esc(l.ip) + '</td></tr>').join('')
      : '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">No activity recorded yet.</td></tr>';
  } catch (err) { toast(err.message, 'error'); }
}

/* ============================================================
   SETTINGS
   ============================================================ */
async function initSettings() {
  $('#curUsername').textContent = App.user.username;

  /* Change username */
  $('#usernameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/settings/username', { method: 'POST', body: { username: $('#newUsername').value.trim() } });
      App.token = data.token; App.user = data.user;
      localStorage.setItem('mxv_token', data.token);
      localStorage.setItem('mxv_user', JSON.stringify(data.user));
      renderShell();
      $('#curUsername').textContent = data.user.username;
      $('#newUsername').value = '';
      toast('Username updated');
    } catch (err) { toast(err.message, 'error'); }
  });

  /* Change password */
  $('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const np = $('#newPassword').value;
    if (np !== $('#newPassword2').value) return toast('New passwords do not match', 'error');
    try {
      await api('/api/settings/password', {
        method: 'POST',
        body: { current_password: $('#curPassword').value, new_password: np }
      });
      $('#curPassword').value = ''; $('#newPassword').value = ''; $('#newPassword2').value = '';
      toast('Password updated');
    } catch (err) { toast(err.message, 'error'); }
  });

  /* API key (owner) */
  if (App.user.role === 'owner') {
    try {
      const { api_key } = await api('/api/settings/apikey');
      $('#apiKeyInput').value = api_key;
    } catch { /* panel hidden already if not owner */ }

    $('#apiEndpointText').textContent = 'POST ' + location.origin + '/api/validate';

    $('#apiKeyCopy').addEventListener('click', () => copyText($('#apiKeyInput').value, 'API key copied'));
    $('#copyExampleBtn').addEventListener('click', () => copyText($('#apiExample').textContent, 'Example copied'));

    $('#apiKeyRegen').addEventListener('click', async () => {
      const r = await confirmDialog({
        title: 'Regenerate API key?',
        text: 'All client software using the old key will fail validation until updated.',
        okLabel: 'Regenerate'
      });
      if (!r.ok) return;
      try {
        const { api_key } = await api('/api/settings/apikey/regenerate', { method: 'POST' });
        $('#apiKeyInput').value = api_key;
        toast('New API key generated');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

/* ============================================================
   BOOT
   ============================================================ */
async function init() {
  bindGlobal();
  const page = document.body.dataset.page;

  if (page === 'login') return initLogin();
  if (page === 'register') return initRegister();

  /* Protected pages */
  if (!App.token) { location.replace('index.html'); return; }

  try {
    const { user } = await api('/api/auth/me');
    App.user = user;
    localStorage.setItem('mxv_user', JSON.stringify(user));
    renderShell();

    if (page === 'dashboard') await initDashboard();
    else if (page === 'keys') await initKeys();
    else if (page === 'users') {
      if (user.role !== 'owner') { location.replace('dashboard.html'); return; }
      await initUsers();
    }
    else if (page === 'settings') await initSettings();
  } catch {
    /* 401s are handled inside api() with a redirect */
  }
}

init();