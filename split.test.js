/* Tests for running the website (Netlify / Cloudflare) separately from this API. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createSqlite } = require('../lib/db');
const { createStore } = require('../lib/store');
const { createMailer } = require('../lib/email');
const { createApp } = require('../lib/router');

async function boot(extra) {
  const env = Object.assign({ SESSION_SECRET: 'x'.repeat(40), ADMIN_PASSWORD: 'correct horse battery', EMAIL_PROVIDER: 'none' }, extra);
  const app = createApp({ store: createStore(createSqlite(':memory:'), env), mailer: createMailer(env), env, log: { error() {} } });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = (headers) => fetch(base + '/api/admin/login', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify({ password: 'correct horse battery' }) });
  return { base, login, close: () => new Promise(r => server.close(r)) };
}

test('foreign origin is refused when ALLOWED_ORIGINS is not set', async () => {
  const t = await boot({});
  assert.equal((await t.login({ Origin: 'https://site.netlify.app' })).status, 403);
  await t.close();
});
test('website host listed in ALLOWED_ORIGINS may call the API; others still refused', async () => {
  const t = await boot({ ALLOWED_ORIGINS: 'https://site.netlify.app/, www.example.com' });
  assert.equal((await t.login({ Origin: 'https://site.netlify.app' })).status, 200);
  assert.equal((await t.login({ Origin: 'https://www.example.com' })).status, 200);
  assert.equal((await t.login({ Origin: 'https://evil.example' })).status, 403);
  await t.close();
});
test('x-client-ip is trusted only with the right PROXY_SECRET (rate limit is per visitor, not per proxy)', async () => {
  const t = await boot({ PROXY_SECRET: 'p'.repeat(24) });
  const body = JSON.stringify({ password: 'wrong wrong wrong' });
  const hit = (h) => fetch(t.base + '/api/admin/login', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: t.base }, h), body });
  // visitor A burns the login limit (8 attempts), visitor B (different x-client-ip, same proxy) must still get through
  const good = { 'x-proxy-secret': 'p'.repeat(24) };
  for (let i = 0; i < 8; i++) await hit(Object.assign({ 'x-client-ip': '203.0.113.1' }, good));
  assert.equal((await hit(Object.assign({ 'x-client-ip': '203.0.113.1' }, good))).status, 429);
  assert.equal((await hit(Object.assign({ 'x-client-ip': '203.0.113.2' }, good))).status, 401);
  // wrong secret: the request is refused outright (changed in review: it used to be accepted and rate-limited by socket address,
  // which let anyone who reached the backend directly dodge the limits with a fake X-Forwarded-For)
  const bad = { 'x-proxy-secret': 'nope' };
  for (let i = 0; i < 3; i++) assert.equal((await hit(Object.assign({ 'x-client-ip': '198.51.100.' + i }, bad))).status, 403);
  assert.equal((await hit({ 'X-Forwarded-For': '198.51.100.7' })).status, 403);
  await t.close();
});
test('backend lib/core.js is identical to frontend/core.js (price rules must not drift)', (t) => {
  const f = path.join(__dirname, '..', '..', 'frontend', 'core.js');
  if (!fs.existsSync(f)) return t.skip('frontend folder not next to backend');
  assert.equal(fs.readFileSync(f, 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'lib', 'core.js'), 'utf8'));
});

test('on Render a missing DATABASE_URL is refused (never a throw-away disk)', () => {
  const { createAdapter, ConfigError } = require('../lib/db');
  assert.throws(() => createAdapter({ RENDER: 'true' }), ConfigError);
});
