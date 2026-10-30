/* API routes. createApp({store, mailer, env, now, log}) -> { handle(req,res) }
   Everything the browser sends is untrusted: price, availability and all fields are re-checked here. */
const crypto = require('crypto');
const core = require('./core.js');
const auth = require('./auth');
const { ConfigError } = require('./db');

class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || {}; }
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = (prefix, n) => prefix + Array.from({ length: n || 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const peso = n => 'PHP ' + Number(n).toLocaleString('en-US');
const SESSION_TTL = 8 * 3600 * 1000;
const STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'blocked', 'all'];

function send(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(JSON.stringify(obj));
}

async function readJson(req, limit) {
  limit = limit || 20000;
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') throw new HttpError(415, 'unsupported_media_type');
  let raw;
  if (req.body !== undefined && req.body !== null) { // already parsed by the platform
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) raw = JSON.stringify(req.body);
    else raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (raw.length > limit) throw new HttpError(413, 'too_large');
  } else {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'too_large'); chunks.push(c); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  let v; try { v = JSON.parse(raw); } catch (e) { throw new HttpError(400, 'bad_json'); }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_json');
  return v;
}

/* PROXY_SECRET: when the website host (Netlify / Cloudflare) forwards /api/* to this server, every request arrives from the
   proxy's IP. The proxy sends the real visitor IP in x-client-ip plus the shared secret; only then is that header trusted. */
let TRUSTED_PROXY_SECRET = '';
/* Constant-time comparison (hash both sides first so different lengths cannot throw or leak). */
function sameSecret(a, b) {
  const h = v => crypto.createHash('sha256').update(String(v == null ? '' : v)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}
function clientIp(req) {
  if (TRUSTED_PROXY_SECRET && sameSecret(req.headers['x-proxy-secret'], TRUSTED_PROXY_SECRET) && req.headers['x-client-ip']) return String(req.headers['x-client-ip']).trim();
  /* No proxy secret (single-service mode, e.g. only Render): the platform's own proxy APPENDS the real visitor address, so the LAST entry
     is the trustworthy one. The first entry can be forged by the visitor, so it is never used. */
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return xff[xff.length - 1] || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* Cross-site request protection. A browser always sends Origin on POST; it must be our own host. */
function assertSameOriginFn(req, strict, allowedHosts) {
  const o = req.headers.origin;
  if (o) { let ok = false; try { const h = new URL(o).host; ok = h === req.headers.host || (allowedHosts || []).includes(h); } catch (e) {} if (!ok) throw new HttpError(403, 'bad_origin'); return; }
  if (strict) { const sf = req.headers['sec-fetch-site']; if (sf !== 'same-origin' && sf !== 'none') throw new HttpError(403, 'bad_origin'); }
}

function createApp({ store, mailer, env, now, log }) {
  now = now || Date.now; log = log || console; env = env || {};
  /* ALLOWED_ORIGINS: comma-separated website hosts (e.g. www.example.com,mysite.netlify.app) that may call this API through the proxy. */
  const allowedHosts = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  TRUSTED_PROXY_SECRET = String(env.PROXY_SECRET || '');
  const assertOrigin = (req, strict) => assertSameOriginFn(req, strict, allowedHosts);
  const holdHours = Number(env.HOLD_HOURS) > 0 ? Number(env.HOLD_HOURS) : 24;
  const secret = env.SESSION_SECRET || '';
  const siteUrl = String(env.SITE_URL || '').replace(/\/+$/, '');
  const cookieSecure = !!(env.VERCEL || env.RENDER || env.COOKIE_SECURE === '1');
  const stripUnit = ({ active, ...u }) => u;

  async function limit(req, scope, windowMs, max) {
    const r = await store.hit(scope + ':' + auth.hashIp(clientIp(req), secret || env.IP_HASH_SECRET), windowMs, max, now());
    if (!r.allowed) throw new HttpError(429, 'rate_limited', { retryAfterSec: r.retryAfterSec });
  }
  function requireAdmin(req) {
    if (req.method !== 'GET') assertOrigin(req, true);
    const t = auth.parseCookies(req.headers.cookie).mp_admin;
    if (!auth.verifySession(t, secret, now())) throw new HttpError(401, 'unauthorized');
  }
  const cookie = (v, maxAge) => 'mp_admin=' + v + '; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (cookieSecure ? '; Secure' : '');
  const fmtTime = ms => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

  /* Activity log. Never blocks or fails the action it describes, and never contains passwords or codes. */
  async function audit(req, action, detail) {
    try { await store.addAudit({ at: now(), action, detail: core.cleanText(detail || '', 200), ip: auth.hashIp(clientIp(req), secret || env.IP_HASH_SECRET).slice(0, 10) }); }
    catch (e) { log.error('audit failed:', e && e.message); }
  }

  /* ---------- public ---------- */
  async function getUnits(req, res) {
    const [units, rules] = await Promise.all([store.getUnits(), store.getRules()]);
    send(res, 200, { units: units.map(stripUnit), rules: rules.map(r => ({ unit: r.unit, from: r.from, to: r.to, price: r.price })) },
      { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  }
  async function getAvailability(req, res, url) {
    const today = core.manilaToday(now());
    let from = url.searchParams.get('from') || today, to = url.searchParams.get('to') || core.addDays(today, 400);
    if (!core.isValidDate(from) || !core.isValidDate(to) || to <= from) throw new HttpError(422, 'validation', { fields: { dates: 'Invalid date range.' } });
    if (core.nightsBetween(from, to) > 800) to = core.addDays(from, 800);
    send(res, 200, { busy: await store.getBusy(from, to, now()) }, { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=20' });
  }
  async function postBooking(req, res) {
    assertOrigin(req, false);
    await limit(req, 'bk', 10 * 60 * 1000, 5);
    const body = await readJson(req);
    if (body.botcheck) return send(res, 201, { ok: true, code: randCode('MP-'), status: 'pending', total: 0, nights: 0, holdHours }); // spam trap: pretend success, store nothing
    const unit = (await store.getUnits()).find(u => u.id === (typeof body.unit === 'string' ? body.unit : ''));
    const v = core.validateBooking(body, unit, core.manilaToday(now()));
    if (!v.ok) throw new HttpError(422, 'validation', { fields: v.fields });
    const q = core.quote(unit, v.value.ci, v.value.co, v.value.guests, await store.getRules());
    let r = null, code;
    for (let i = 0; i < 5; i++) {
      code = randCode('MP-');
      r = await store.createBooking({ code, unit: unit.id, ci: v.value.ci, co: v.value.co, guests: v.value.guests, name: v.value.name, phone: v.value.phone, email: v.value.email, status: 'pending', total: q.total, holdExpires: now() + holdHours * 3600 * 1000 }, now());
      if (r.ok || r.reason !== 'code') break;
    }
    if (!r.ok) {
      if (r.reason === 'conflict') throw new HttpError(409, 'dates_taken');
      throw new Error('could not create booking');
    }
    const mail = await mailer.notifyHost('Booking request ' + code + ' - Unit ' + unit.id, {
      name: v.value.name, email: v.value.email, phone: v.value.phone, Reference: code, Unit: unit.id + ' ' + unit.tower,
      'Check-in': v.value.ci + ' (from 2:00 PM)', 'Check-out': v.value.co + ' (by 12:00 noon)', Nights: String(q.n), Guests: String(v.value.guests),
      Total: peso(q.total), 'Dates held until': fmtTime(now() + holdHours * 3600 * 1000), Dashboard: siteUrl ? siteUrl + '/admin' : '/admin',
      message: 'New booking REQUEST. Open the dashboard to confirm or decline.'
    });
    await store.setNotify('bookings', r.id, mail.ok, mail.error);
    send(res, 201, { ok: true, code, status: 'pending', total: q.total, nights: q.n, holdHours });
  }
  async function postInquiry(req, res) {
    assertOrigin(req, false);
    await limit(req, 'inq', 60 * 60 * 1000, 5);
    const body = await readJson(req);
    if (body.botcheck) return send(res, 201, { ok: true });
    const v = core.validateInquiry(body, core.manilaToday(now()));
    if (!v.ok) throw new HttpError(422, 'validation', { fields: v.fields });
    const id = await store.addInquiry(v.value, now());
    const mail = await mailer.notifyHost('Group inquiry from ' + v.value.name + ' (' + v.value.guests + ' guests)', {
      name: v.value.name, email: v.value.email, phone: v.value.phone, 'Check-in': v.value.ci, 'Check-out': v.value.co, Guests: String(v.value.guests), message: v.value.message || '(no message)'
    });
    await store.setNotify('inquiries', id, mail.ok, mail.error);
    send(res, 201, { ok: true });
  }

  /* ---------- admin ---------- */
  async function adminLogin(req, res) {
    assertOrigin(req, true);
    if (auth.adminConfigProblem(env)) throw new HttpError(503, 'admin_not_configured');
    await limit(req, 'login', 15 * 60 * 1000, 8);
    const body = await readJson(req, 2000);
    const pwOk = auth.verifyPassword(body.password, env);
    if (!env.ADMIN_TOTP_SECRET) { // 2-step login is off (the dashboard shows a warning)
      if (!pwOk) { await audit(req, 'login_failed', 'wrong password'); throw new HttpError(401, 'wrong_password'); }
    } else {
      // 2-step login is on: password AND a fresh 6-digit code. One generic error so nobody learns which half was wrong.
      let codeOk = false;
      if (pwOk) {
        const g = await store.hit('totp-global', 15 * 60 * 1000, 20, now()); // caps guessing even from many addresses
        if (!g.allowed) throw new HttpError(429, 'rate_limited', { retryAfterSec: g.retryAfterSec });
        const step = auth.verifyTotp(env.ADMIN_TOTP_SECRET, body.code, now());
        codeOk = step !== null && await store.claimTotp(step); // a code cannot be used twice
      }
      if (!pwOk || !codeOk) { await audit(req, 'login_failed', pwOk ? 'wrong or reused code' : 'wrong password'); throw new HttpError(401, 'wrong_login'); }
    }
    await audit(req, 'login_ok', env.ADMIN_TOTP_SECRET ? 'with 2-step code' : 'password only (2-step is OFF)');
    send(res, 200, { ok: true }, { 'Set-Cookie': cookie(auth.signSession(secret, now(), SESSION_TTL), Math.floor(SESSION_TTL / 1000)) });
  }
  async function adminLogout(req, res) { assertOrigin(req, true); send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); }
  async function adminSession(req, res) { send(res, 200, { authenticated: auth.verifySession(auth.parseCookies(req.headers.cookie).mp_admin, secret, now()), twofa: !!env.ADMIN_TOTP_SECRET }); }
  async function adminBookings(req, res, url) {
    requireAdmin(req);
    const st = url.searchParams.get('status') || 'all';
    if (!STATUSES.includes(st)) throw new HttpError(422, 'validation', { fields: { status: 'Unknown status.' } });
    send(res, 200, { bookings: await store.listBookings({ status: st, limit: 300 }, now()) });
  }
  async function adminAction(req, res) {
    requireAdmin(req);
    const body = await readJson(req, 2000);
    if (!Number.isInteger(body.id) || !['confirm', 'decline', 'cancel'].includes(body.action)) throw new HttpError(422, 'validation', { fields: { action: 'Invalid request.' } });
    const r = await store.transition(body.id, body.action, now());
    if (!r.ok) throw new HttpError(r.reason === 'notfound' ? 404 : 409, r.reason === 'conflict' ? 'dates_taken' : r.reason === 'state' ? 'invalid_state' : 'not_found');
    const b = r.booking; let guestMail = 'skipped';
    await audit(req, 'booking_' + body.action, b.code + ' unit ' + b.unit + ' ' + b.ci + ' to ' + b.co);
    if (b.status !== 'blocked' && b.email && b.email !== '-') {
      const unit = (await store.getUnits({ all: true })).find(u => u.id === b.unit);
      const first = String(b.name).split(' ')[0];
      const where = 'Reference: ' + b.code + '\nUnit: ' + b.unit + (unit ? ' ' + unit.tower : '') + '\nCheck-in: ' + b.ci + ' (from 2:00 PM)\nCheck-out: ' + b.co + ' (by 12:00 noon)\nTotal: ' + peso(b.total);
      const texts = {
        confirmed: ['Your Manila Prime booking is confirmed (' + b.code + ')', 'Hi ' + first + ',\n\nGood news - your stay at Manila Prime Staycation is confirmed.\n\n' + where + '\n\nIf anything changes, call or WhatsApp 0985 060 0545.\n\nManila Prime Staycation'],
        declined: ['About your Manila Prime request (' + b.code + ')', 'Hi ' + first + ',\n\nSorry, we could not confirm this request.\n\n' + where + '\n\nPlease message us on 0985 060 0545 and we will help you find other dates or a different unit.\n\nManila Prime Staycation'],
        cancelled: ['Your Manila Prime booking was cancelled (' + b.code + ')', 'Hi ' + first + ',\n\nYour booking has been cancelled.\n\n' + where + '\n\nQuestions? Call or WhatsApp 0985 060 0545.\n\nManila Prime Staycation']
      }[b.status];
      if (texts) { const m = await mailer.notifyGuest(b.email, texts[0], texts[1]); guestMail = m.skipped ? 'skipped' : m.ok ? 'sent' : 'failed'; }
    }
    send(res, 200, { ok: true, booking: b, guestMail });
  }
  async function adminBlock(req, res) {
    requireAdmin(req);
    const body = await readJson(req, 2000), today = core.manilaToday(now());
    const unit = (await store.getUnits({ all: true })).find(u => u.id === body.unit);
    const f = {};
    if (!unit) f.unit = 'Choose a unit.';
    if (!core.isValidDate(body.from) || !core.isValidDate(body.to) || body.to <= body.from) f.dates = 'Choose a start date and a later end date.';
    else if (body.from < today) f.dates = 'Blocks cannot start in the past.';
    if (Object.keys(f).length) throw new HttpError(422, 'validation', { fields: f });
    const r = await store.createBooking({ code: randCode('BLK-', 5), unit: unit.id, ci: body.from, co: body.to, guests: 0, name: 'Blocked by host', phone: '-', email: '-', status: 'blocked', total: 0, holdExpires: null, note: core.cleanText(body.note, 100) }, now());
    if (!r.ok) throw new HttpError(409, r.reason === 'conflict' ? 'dates_taken' : 'try_again');
    await audit(req, 'dates_blocked', 'unit ' + unit.id + ' ' + body.from + ' to ' + body.to);
    send(res, 201, { ok: true });
  }
  async function adminUnits(req, res) {
    requireAdmin(req);
    send(res, 200, { units: await store.getUnits({ all: true }), rules: await store.getRules() });
  }
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  async function adminRates(req, res) {
    requireAdmin(req);
    const b = await readJson(req, 2000);
    const unit = (await store.getUnits({ all: true })).find(u => u.id === b.unit);
    if (!unit || !int(b.weekday, 1, 1000000) || !int(b.weekend, 1, 1000000) || !int(b.extra, 0, 100000)) throw new HttpError(422, 'validation', { fields: { rates: 'Enter whole peso amounts.' } });
    await store.updateRates(unit.id, { weekday: b.weekday, weekend: b.weekend, extra: b.extra });
    await audit(req, 'rates_changed', 'unit ' + unit.id + ': ' + unit.price + '/' + unit.weekend + '/' + unit.extra + ' -> ' + b.weekday + '/' + b.weekend + '/' + b.extra);
    send(res, 200, { ok: true });
  }
  async function adminAddRule(req, res) {
    requireAdmin(req);
    const b = await readJson(req, 2000), units = await store.getUnits({ all: true });
    const f = {};
    if (b.unit !== 'all' && !units.some(u => u.id === b.unit)) f.unit = 'Choose a unit.';
    if (!core.isValidDate(b.from) || !core.isValidDate(b.to) || b.to < b.from) f.dates = 'Choose a first night and a last night on or after it.';
    if (!int(b.price, 1, 1000000)) f.price = 'Enter the rate per night in whole pesos.';
    if (Object.keys(f).length) throw new HttpError(422, 'validation', { fields: f });
    await store.addRule({ unit: b.unit, from: b.from, to: b.to, price: b.price, label: core.cleanText(b.label, 60) });
    await audit(req, 'special_rate_added', (b.unit === 'all' ? 'all units' : 'unit ' + b.unit) + ' ' + b.from + ' to ' + b.to + ' = ' + b.price);
    send(res, 201, { ok: true });
  }
  async function adminDelRule(req, res) {
    requireAdmin(req);
    const b = await readJson(req, 500);
    if (!Number.isInteger(b.id)) throw new HttpError(422, 'validation', { fields: { id: 'Invalid.' } });
    await store.deleteRule(b.id);
    await audit(req, 'special_rate_deleted', 'rule ' + b.id);
    send(res, 200, { ok: true });
  }
  /* ---- rooms / units: add, edit, switch on or off ---- */
  const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,14}$/;
  function unitFields(b, f) {
    const v = { tower: core.cleanText(b.tower, 60), beds: core.cleanText(b.beds, 80), desc: core.cleanText(b.desc, 300), perks: core.cleanText(b.perks, 160), base: b.base, max: b.max, extra: b.extra };
    if (!v.tower) f.tower = 'Enter the building or tower name.';
    if (!v.beds) f.beds = 'Enter the beds, for example "Queen Bed + Sofa Bed".';
    if (!int(v.base, 1, 4)) f.base = 'Base guests must be a whole number from 1 to 4.';
    if (!int(v.max, 1, 4) || (int(v.base, 1, 4) && v.max < v.base)) f.max = 'Maximum guests must be from 1 to 4 and not less than the base guests.';
    if (!int(v.extra, 0, 100000)) f.extra = 'Extra guest fee must be whole pesos (0 or more).';
    return v;
  }
  async function adminAddUnit(req, res) {
    requireAdmin(req);
    const b = await readJson(req, 4000), f = {};
    const v = unitFields(b, f);
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    if (!UNIT_ID.test(id)) f.id = 'Unit number: letters, numbers, - or _ only (up to 15 characters, no spaces).';
    if (!int(b.weekday, 1, 1000000) || !int(b.weekend, 1, 1000000)) f.rates = 'Enter whole peso amounts for both nightly rates.';
    if (Object.keys(f).length) throw new HttpError(422, 'validation', { fields: f });
    const r = await store.addUnit({ id, tower: v.tower, beds: v.beds, desc: v.desc, perks: v.perks, base: v.base, max: v.max, extra: v.extra, price: b.weekday, weekend: b.weekend });
    if (!r.ok) throw new HttpError(409, 'unit_exists');
    await audit(req, 'unit_added', 'unit ' + id + ' ' + v.tower + ' rates ' + b.weekday + '/' + b.weekend);
    send(res, 201, { ok: true });
  }
  async function adminUpdateUnit(req, res) {
    requireAdmin(req);
    const b = await readJson(req, 4000), f = {};
    const unit = (await store.getUnits({ all: true })).find(u => u.id === b.id);
    if (!unit) throw new HttpError(404, 'not_found');
    const v = unitFields(b, f);
    if (Object.keys(f).length) throw new HttpError(422, 'validation', { fields: f });
    await store.updateUnit(unit.id, v);
    await audit(req, 'unit_updated', 'unit ' + unit.id);
    send(res, 200, { ok: true });
  }
  async function adminUnitActive(req, res) {
    requireAdmin(req);
    const b = await readJson(req, 500);
    if (typeof b.id !== 'string' || typeof b.active !== 'boolean') throw new HttpError(422, 'validation', { fields: { unit: 'Invalid request.' } });
    const r = await store.setActive(b.id, b.active);
    if (!r.ok) throw new HttpError(r.reason === 'last' ? 409 : 404, r.reason === 'last' ? 'last_unit' : 'not_found');
    await audit(req, b.active ? 'unit_on' : 'unit_off', 'unit ' + b.id);
    send(res, 200, { ok: true });
  }
  async function adminAudit(req, res) { requireAdmin(req); send(res, 200, { log: await store.listAudit(100) }); }
  async function adminInquiries(req, res) { requireAdmin(req); send(res, 200, { inquiries: await store.listInquiries(100) }); }

  const routes = {
    'GET /api/health': async (req, res) => send(res, 200, { ok: true }),
    'GET /api/units': getUnits, 'GET /api/availability': getAvailability,
    'POST /api/bookings': postBooking, 'POST /api/inquiries': postInquiry,
    'POST /api/admin/login': adminLogin, 'POST /api/admin/logout': adminLogout, 'GET /api/admin/session': adminSession,
    'GET /api/admin/bookings': adminBookings, 'POST /api/admin/booking-action': adminAction, 'POST /api/admin/blocks': adminBlock,
    'GET /api/admin/units': adminUnits, 'POST /api/admin/rates': adminRates,
    'POST /api/admin/units-add': adminAddUnit, 'POST /api/admin/units-update': adminUpdateUnit, 'POST /api/admin/units-active': adminUnitActive, 'GET /api/admin/audit': adminAudit,
    'POST /api/admin/rules': adminAddRule, 'POST /api/admin/rules-delete': adminDelRule, 'GET /api/admin/inquiries': adminInquiries
  };

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      /* When a proxy secret is configured the API is only for the website's own proxy. Anyone calling the backend address directly
         (which would let them fake X-Forwarded-For and dodge every rate limit and login lockout) is refused. Only /api/health stays open for uptime monitors. */
      if (TRUSTED_PROXY_SECRET && path !== '/api/health' && !sameSecret(req.headers['x-proxy-secret'], TRUSTED_PROXY_SECRET)) throw new HttpError(403, 'use_the_website');
      const h = routes[req.method + ' ' + path];
      if (!h) {
        const other = Object.keys(routes).filter(k => k.endsWith(' ' + path)).map(k => k.split(' ')[0]);
        if (other.length) throw new HttpError(405, 'method_not_allowed', { allow: other });
        throw new HttpError(404, 'not_found');
      }
      if (path !== '/api/health') await store.ready();
      await h(req, res, url);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof HttpError) {
        const hdr = {};
        if (e.status === 429) hdr['Retry-After'] = String(e.extra.retryAfterSec || 60);
        if (e.status === 405) hdr.Allow = e.extra.allow.join(', ');
        if (e.status === 413) hdr.Connection = 'close';
        return send(res, e.status, Object.assign({ error: e.code }, e.extra.fields ? { fields: e.extra.fields } : {}, e.status === 429 ? { retryAfterSec: e.extra.retryAfterSec } : {}), hdr);
      }
      if (e instanceof ConfigError) { log.error('config error:', e.message); return send(res, 503, { error: 'not_configured' }); }
      log.error('api error:', e && e.message); // never send internals to the browser
      send(res, 500, { error: 'server_error' });
    }
  }
  return { handle };
}

module.exports = { createApp, HttpError };
