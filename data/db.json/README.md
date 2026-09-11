# MAX VIP — Software License Management Panel

Production-ready SaaS licensing panel: JWT auth, referral-only registration,
key generation (standard + custom), HWID device binding, ban/block controls,
owner admin panel, and a public validation API — wrapped in an RGB Liquid Glass UI.

**MADE BY MAX · TG: @kryvexo**

---

## Quick Start (local)

```bash
npm install
npm start          # http://localhost:3000
```

The database (`data/db.json`) and the owner account are auto-created on first boot.

### Owner credentials
| Username       | Password   | Role  |
|----------------|------------|-------|
| `bhatzubair4054` | `Bhat@123` | owner |

> Change these after first login in **Settings**, or edit the seed constants in `lib/db.js`.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Or import the repo in the Vercel dashboard (zero-config — `vercel.json` handles routing).

### Optional environment variables
| Variable      | Purpose                                        |
|---------------|------------------------------------------------|
| `CORS_ORIGIN` | Comma-separated allowed origins (default: all) |
| `DB_PATH`     | Override database file path                    |

### Data persistence (important)
On Vercel the JSON database lives in `/tmp` (the only writable serverless path).
It persists across warm invocations but resets on cold starts / redeployments.
For serious production use, swap `lib/db.js` internals for Vercel KV, Vercel Blob,
or any external DB — every route already goes through that single module.

---

## Roles

- **owner** — full access: users, referrals, API key config, all keys.
- **user** — registers with a one-time referral code; can generate & manage their own keys.

---

## Validation API (for your client software)

```bash
curl -X POST https://your-app.vercel.app/api/validate \
  -H "Content-Type: application/json" \
  -d '{"license_key":"XXXX-XXXX-XXXX-XXXX-XXXX","hwid":"USER-PC-01","api_key":"mxv_live_..."}'
```

Response:

```json
{ "status": "valid", "message": "License is valid", "expires_at": "2026-10-11T00:00:00.000Z",
  "device_limit": 1, "devices_used": 1, "duration": "30d" }
```

Rules: API key gate → key exists → not banned/blocked → not expired → HWID auto-locks
on first use within the device limit. Get the product API key from **Settings → API Integration**.

## Endpoint map

| Method | Route | Access |
|---|---|---|
| POST | /api/auth/login · /register · /logout | public / auth |
| GET  | /api/auth/me | auth |
| GET  | /api/keys | auth |
| POST | /api/keys/generate · /custom · /block · /ban · /unblock · /reset-hwid | auth |
| DELETE | /api/keys/:key | auth |
| GET  | /api/users | owner |
| PUT  | /api/users/:id | owner |
| POST | /api/users/ban | owner |
| DELETE | /api/users/:id | owner |
| POST | /api/validate | public (api_key) |
| POST | /api/settings/username · /password | auth |
| GET/POST | /api/settings/apikey(+/regenerate) | owner |
| GET  | /api/referral/generate · /list | owner |

## Security
bcrypt password hashing · JWT sessions (7d) · login/register/validate rate limiting ·
helmet headers · CORS config · input validation & sanitization · owner account protection.