import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http'; import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createSqlite } = require('../lib/db'); const { createStore } = require('../lib/store'); const { createMailer } = require('../lib/email'); const { createApp } = require('../lib/router');
/* The Cloudflare function is an ES module inside a folder Node treats as CommonJS, so load it from its source text. */
const fnSrc = readFileSync(new URL('../../frontend/functions/api/[[path]].js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(fnSrc).toString('base64'));
test('Cloudflare proxy function -> backend with the fix: works, passes the cookie, and direct access is refused', async () => {
  const SECRET = 'p'.repeat(30);
  const env = { SESSION_SECRET: 'x'.repeat(40), ADMIN_PASSWORD: 'correct horse battery', PROXY_SECRET: SECRET, ALLOWED_ORIGINS: 'site.pages.dev', EMAIL_PROVIDER: 'none', COOKIE_SECURE: '1' };
  const app = createApp({ store: createStore(createSqlite(':memory:'), env), mailer: createMailer(env), env, log: { error() {} } });
  const srv = http.createServer((q, s) => app.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const backend = 'http://127.0.0.1:' + srv.address().port, penv = { BACKEND_URL: backend, PROXY_SECRET: SECRET };
  const viaProxy = (path, init = {}, ip = '203.0.113.50') => onRequest({ request: new Request('https://site.pages.dev' + path, { ...init, headers: { Origin: 'https://site.pages.dev', 'cf-connecting-ip': ip, 'sec-fetch-site': 'same-origin', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } }), env: penv });
  const u = await viaProxy('/api/units'); assert.equal(u.status, 200); assert.equal((await u.json()).units.length, 14);
  const login = await viaProxy('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery' }) });
  assert.equal(login.status, 200); const sc = login.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Secure/);
  const s = await viaProxy('/api/admin/bookings', { headers: { Cookie: sc.split(';')[0] } }); assert.equal(s.status, 200); // cookie round-trips through the proxy
  const codes = []; for (let i = 0; i < 10; i++) codes.push((await viaProxy('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'wrong ' + i }) }, '198.51.100.9')).status);
  assert.equal(codes[8], 429); // lockout works per visitor through the proxy
  assert.equal((await viaProxy('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery' }) }, '198.51.100.77')).status, 200); // other visitor fine
  assert.equal((await fetch(backend + '/api/units')).status, 403); // direct to the backend address: refused
  assert.equal((await fetch(backend + '/api/health')).status, 200); // uptime monitor still works
  const wrongProxy = await onRequest({ request: new Request('https://site.pages.dev/api/units'), env: { BACKEND_URL: backend, PROXY_SECRET: 'q'.repeat(30) } }); assert.equal(wrongProxy.status, 403); // mismatched secret between Cloudflare and Render
  const unconfigured = await onRequest({ request: new Request('https://site.pages.dev/api/units'), env: {} }); assert.equal(unconfigured.status, 503);
  srv.close();
});
