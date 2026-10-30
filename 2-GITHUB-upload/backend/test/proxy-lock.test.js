/* Review fix: with PROXY_SECRET set, the backend refuses direct calls, so a fake X-Forwarded-For cannot dodge rate limits. */
const test = require('node:test'); const assert = require('node:assert/strict'); const http = require('http');
const { createSqlite } = require('../lib/db'); const { createStore } = require('../lib/store');
const { createMailer } = require('../lib/email'); const { createApp } = require('../lib/router');
const SECRET = 'p'.repeat(30);
async function boot(extra) {
  const env = Object.assign({ SESSION_SECRET: 'x'.repeat(40), ADMIN_PASSWORD: 'correct horse battery', ALLOWED_ORIGINS: 'site.pages.dev', EMAIL_PROVIDER: 'none' }, extra);
  const app = createApp({ store: createStore(createSqlite(':memory:'), env), mailer: createMailer(env), env, now: () => Date.parse('2026-10-28T02:00:00Z'), log: { error() {} } });
  const srv = http.createServer((q, s) => app.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, path, body, headers) => { const r = await fetch(base + path, { method, headers: Object.assign({ Origin: 'https://site.pages.dev' }, body ? { 'Content-Type': 'application/json' } : {}, headers), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; };
  return { call, close: () => new Promise(r => srv.close(r)) };
}
test('proxy secret set: direct calls are refused (403), health stays open', async () => {
  const t = await boot({ PROXY_SECRET: SECRET });
  for (const [m, p, b] of [['GET', '/api/units'], ['GET', '/api/availability'], ['POST', '/api/bookings', {}], ['POST', '/api/inquiries', {}], ['POST', '/api/admin/login', { password: 'x' }], ['GET', '/api/admin/session'], ['GET', '/api/nothing']]) {
    const r = await t.call(m, p, b); assert.equal(r.status, 403, m + ' ' + p); assert.equal(r.body.error, 'use_the_website');
  }
  assert.equal((await t.call('GET', '/api/units', undefined, { 'x-proxy-secret': 'wrong' })).status, 403);
  assert.equal((await t.call('GET', '/api/units', undefined, { 'x-proxy-secret': 'p' })).status, 403); // shorter value must not crash
  assert.equal((await t.call('GET', '/api/health')).status, 200);
  assert.equal((await t.call('GET', '/api/units', undefined, { 'x-proxy-secret': SECRET, 'x-client-ip': '198.51.100.1' })).status, 200);
  await t.close();
});
test('the attack from the review no longer works: 40 logins with fake X-Forwarded-For never reach the login check', async () => {
  const t = await boot({ PROXY_SECRET: SECRET });
  const codes = []; for (let i = 0; i < 40; i++) codes.push((await t.call('POST', '/api/admin/login', { password: 'guess ' + i }, { 'X-Forwarded-For': '203.0.113.' + i })).status);
  assert.deepEqual([...new Set(codes)], [403]);
  await t.close();
});
test('through the proxy: lockout is per visitor and a fake X-Forwarded-For changes nothing', async () => {
  const t = await boot({ PROXY_SECRET: SECRET });
  const via = (ip, extra) => Object.assign({ 'x-proxy-secret': SECRET, 'x-client-ip': ip }, extra);
  const codes = []; for (let i = 0; i < 10; i++) codes.push((await t.call('POST', '/api/admin/login', { password: 'guess ' + i }, via('198.51.100.5', { 'X-Forwarded-For': '9.9.9.' + i }))).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 429, 429]);
  assert.equal((await t.call('POST', '/api/admin/login', { password: 'correct horse battery' }, via('198.51.100.6'))).status, 200); // another visitor is unaffected
  await t.close();
});
test('no proxy secret configured (local development): unchanged', async () => {
  const t = await boot({});
  assert.equal((await t.call('GET', '/api/units')).status, 200);
  await t.close();
});
