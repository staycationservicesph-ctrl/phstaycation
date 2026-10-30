# Manila Prime Staycation - frontend + backend

```
frontend/   the website + host dashboard (static files) + a small /api proxy (functions/api) for Cloudflare Pages
backend/    the API (Node 22 + PostgreSQL): server.js, lib/, scripts/, test/, headers.json
```
## EASIEST: Render only (no Cloudflare needed)
The backend also serves the website, so ONE Render service + Supabase is enough.
1. Supabase: New project > Connect > **Session pooler** string (port 5432) = `DATABASE_URL`.
2. Render: New > Web Service > this repo. **Leave Root Directory EMPTY** (the server needs the `frontend` folder next to `backend`).
   Build command: `cd backend && npm install`   Start command: `cd backend && node server.js`   (Node 22: set `NODE_VERSION=22`)
3. Environment variables: `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `ADMIN_PASSWORD` (12+ characters), `COOKIE_SECURE=1`,
   `EMAIL_PROVIDER` (`none`, `web3forms` or `resend`), `SITE_URL` (your Render address, or your own domain once connected). **Do NOT set `PROXY_SECRET` or `ALLOWED_ORIGINS`.**
4. Open your Render address: the website is at `/`, the host dashboard at `/admin`, health check at `/api/health`.
5. Own domain (phstaycation.online): Render > Settings > Custom Domains, then add the DNS records Render shows at your domain registrar.
6. Free Render sleeps after ~15 min idle (first visit then takes up to ~50 s; the page now waits and retries). Add a free UptimeRobot monitor on `https://YOURSITE/api/units` every 5 minutes: it keeps Render awake and Supabase active.
Everything below about Cloudflare is only needed if you later choose the 2-host setup.

## Website on Netlify + API on Render (frontend / backend split, no Cloudflare)
1. Do the Render steps above first, plus ONE extra variable on Render: `ALLOWED_ORIGINS` = your Netlify address without https://, e.g. `manila-prime.netlify.app` (add your own domain too, comma-separated, once connected). Keep `PROXY_SECRET` unset.
2. Edit `frontend/config.js`: `window.MP_API_BASE = 'https://YOUR-NAME.onrender.com';` (no trailing slash).
3. Edit `frontend/netlify.toml`: replace both `CHANGE-ME` with your Render name.
4. Netlify: Add new site > Import from Git (or drag the `frontend` folder onto app.netlify.com/drop). Build command empty, publish directory `frontend` (Git) .
5. Guests use the Netlify address. YOU manage bookings at `https://YOUR-NAME.onrender.com/admin` (the dashboard must stay on the Render address so the login cookie works; /admin on Netlify forwards you there).
6. Set `SITE_URL` on Render to the Netlify/own-domain address (used in email links).
The public API allows only the hosts in `ALLOWED_ORIGINS` (CORS) and carries no cookies; admin endpoints never allow other sites.

Hosting (optional 2-host setup): **frontend -> Cloudflare Pages**, **backend -> Render**, **database -> Supabase**.
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
Check: `https://YOUR-NAME.onrender.com/api/health` shows `{"ok":true}`. The backend **refuses every other direct visit on purpose** (only your Cloudflare site may use it), so to see the units open `https://YOURSITE/api/units` after step 3.
Render Free sleeps after ~15 min idle, and a free Supabase project pauses after about a week without database use. Add a free uptime monitor (UptimeRobot etc.) that opens **your website address** `https://YOURSITE/api/units` every 5 minutes: it goes through Cloudflare, wakes Render and touches the database. (A monitor on `/api/health` alone would not keep Supabase awake.)
If the website says it cannot load units after deploying: `PROXY_SECRET` is different on Render and Cloudflare, or `BACKEND_URL` is missing.

## 3. Cloudflare Pages (frontend)
Workers & Pages > Create > Pages > Connect to Git > this repo. Framework None, build command empty, output directory `/`, **Root directory `frontend`**.
Variables and Secrets: `BACKEND_URL` = `https://YOUR-NAME.onrender.com` (no trailing slash), `PROXY_SECRET` = same as Render. Redeploy once.
(A project made by uploading files does not run the /api proxy; connect it to Git or deploy with `npx wrangler pages deploy .` from `frontend`.)

## 4. Check
`/api/health` -> `{"ok":true}`; home page shows units; `/admin` login; set real nightly/holiday rates (starting 1,999 is a placeholder); send a test booking from your phone, Confirm then Cancel it.

## 2-step login for /admin (recommended)
The dashboard login can ask for your password AND a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy). The code changes every 30 seconds and works only once.
1. Make a key: `cd backend && node scripts/make-2fa.js` (or ask for one). It looks like `JXGOC5AROFRILXSXVZXQTODJTU4AD267`.
2. Render > Environment > add `ADMIN_TOTP_SECRET` = the key > Save (Render redeploys).
3. In the app: Add account > **Enter a setup key** > name `Manila Prime` > paste the key > Time based.
4. Open `/admin`: password + code. Until step 2 is done the dashboard shows a red "2-step login is OFF" warning.
Keep the key somewhere safe (not in GitHub). If you lose your phone, removing `ADMIN_TOTP_SECRET` in Render turns 2-step off so you can get back in.

## Rooms and availability (in /admin)
- **Add a room**: unit number, building, beds, description, perks, guests (1-4), extra-guest fee, nightly rates. It appears on the website within a few minutes.
- **Edit** details of a room (prices are changed in "Nightly rates").
- **Turn off / on**: an Off room is hidden from guests and cannot be booked; existing bookings stay. At least one room must stay On. Rooms are never deleted so old bookings keep their record.
- **Block dates** closes single dates for a room (already there).
- **Activity log** lists logins (also failed ones) and every change to prices, rooms and bookings.

## Features added
- Shareable search links: `/?checkin=2026-12-20&checkout=2026-12-23&guests=2`
- Save (heart) on unit cards + "Saved only" filter (kept in the guest's own browser)

## Local run / tests (optional)
`cd backend && npm install && cp .env.example .env && npm start` (http://localhost:3000, serves ../frontend) / `npm test` / `python3 test/e2e.py` (needs playwright).
`backend/lib/core.js` must stay identical to `frontend/core.js` (a test checks this).

## Verified / NOT VERIFIED
VERIFIED locally (re-run during review): 37 backend tests; browser tests 39/39, admin 18/18, features 15/15; the Cloudflare proxy function tested against the backend.
NOT VERIFIED: real Render/Supabase/Cloudflare deployment, real PostgreSQL, email delivery, Safari/Firefox.

## Review changes (security fix)
Found and fixed: with the backend reachable on its own address, a visitor could send a fake `X-Forwarded-For` and dodge every rate limit and the login lockout (40 wrong passwords in a row were never blocked). Now, when `PROXY_SECRET` is set, the backend refuses everything except `/api/health` unless the Cloudflare proxy's secret is present (compared in constant time). Tests: `test/proxy-lock.test.js`, `test/proxy-function.test.mjs`; `test/split.test.js` was updated to the stricter rule.

## Second review (fixes)
- Render-only mode added (see top). Static serving hides dotfiles, `_headers`, `functions/` and `.env.example`.
- Without `PROXY_SECRET` the visitor address is taken from the LAST `X-Forwarded-For` entry (added by Render), never the first (forgeable).
- The website waits up to 45 s and retries once when the server is waking up.
- 360px sideways scroll fixed in the search form.
