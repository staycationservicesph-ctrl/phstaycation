# Manila Prime Staycation - frontend + backend

```
frontend/   the website + host dashboard (static files) + a small /api proxy (functions/api) for Cloudflare Pages
backend/    the API (Node 22 + PostgreSQL): server.js, lib/, scripts/, test/, headers.json
```
Hosting: **frontend -> Cloudflare Pages**, **backend -> Render**, **database -> Supabase**.
The website code expects the site and `/api` on the same address, so the Cloudflare proxy forwards `/api/*` to Render.

## 1. Supabase (database)
New project > Connect > Connection string > **Session pooler** (port 5432). Replace `[YOUR-PASSWORD]`. This is `DATABASE_URL`.

## 2. Render (backend)
New > Web Service > this repo. **Root Directory `backend`**, Build `npm install`, Start `node server.js`.
Environment variables:

| Name | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | the Supabase string |
| `SESSION_SECRET` | 32+ random characters |
| `ADMIN_PASSWORD` | 12+ characters (or `ADMIN_PASSWORD_HASH`: `node scripts/hash-password.js "your password"`) |
| `PROXY_SECRET` | 24+ random characters (same value in Cloudflare) |
| `COOKIE_SECURE` | `1` |
| `EMAIL_PROVIDER` | `none`, `web3forms` or `resend` |
| `ALLOWED_ORIGINS` | your Cloudflare host without https://, e.g. `mysite.pages.dev` (comma-separate more) |
| `SITE_URL` | `https://mysite.pages.dev` |

Email: `web3forms` needs `WEB3FORMS_ACCESS_KEY` (emails only you; may need a paid plan for server sending). `resend` needs `RESEND_API_KEY`, `NOTIFY_TO`, `MAIL_FROM`.
Check: `https://YOUR-NAME.onrender.com/api/units` shows the units. Render Free sleeps after ~15 min idle: add a free uptime monitor on `/api/health` every 5 minutes.

## 3. Cloudflare Pages (frontend)
Workers & Pages > Create > Pages > Connect to Git > this repo. Framework None, build command empty, output directory `/`, **Root directory `frontend`**.
Variables and Secrets: `BACKEND_URL` = `https://YOUR-NAME.onrender.com` (no trailing slash), `PROXY_SECRET` = same as Render. Redeploy once.
(A project made by uploading files does not run the /api proxy; connect it to Git or deploy with `npx wrangler pages deploy .` from `frontend`.)

## 4. Check
`/api/health` -> `{"ok":true}`; home page shows units; `/admin` login; set real nightly/holiday rates (starting 1,999 is a placeholder); send a test booking from your phone, Confirm then Cancel it.

## Features added
- Shareable search links: `/?checkin=2026-12-20&checkout=2026-12-23&guests=2`
- Save (heart) on unit cards + "Saved only" filter (kept in the guest's own browser)

## Local run / tests (optional)
`cd backend && npm install && cp .env.example .env && npm start` (http://localhost:3000, serves ../frontend) / `npm test` / `python3 test/e2e.py` (needs playwright).
`backend/lib/core.js` must stay identical to `frontend/core.js` (a test checks this).

## Verified / NOT VERIFIED
VERIFIED locally: 25 backend tests; browser tests 38/39 (the one failure, horizontal scroll at 360px width, existed in the original); proxy tested locally.
NOT VERIFIED: real Render/Supabase/Cloudflare deployment, real PostgreSQL, email delivery, Safari/Firefox.
