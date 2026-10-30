/* Website on another host (Netlify) calling the API directly: CORS only for allowed hosts and only for public endpoints. */
const test = require('node:test'); const assert = require('node:assert/strict'); const http = require('http');
const { createSqlite } = require('../lib/db'); const { createStore } = require('../lib/store');
const { createMailer } = require('../lib/email'); const { createApp } = require('../lib/router');
async function boot() {
  const env = { SESSION_SECRET: 'x'.repeat(40), ADMIN_PASSWORD: 'correct horse battery', ALLOWED_ORIGINS: 'mysite.netlify.app', EMAIL_PROVIDER: 'none' };
  const app = createApp({ store: createStore(createSqlite(':memory:'), env), mailer: createMailer(env), env, now: () => Date.parse('2026-10-28T02:00:00Z'), log: { error() {} } });
  const srv = http.createServer((q, s) => app.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { base: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise(r => srv.close(r)) };
}
test('CORS: allowed site gets headers on public endpoints, others and admin do not', async () => {
  const t = await boot();
  const ok = await fetch(t.base + '/api/units', { headers: { Origin: 'https://mysite.netlify.app' } });
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://mysite.netlify.app');
  const evil = await fetch(t.base + '/api/units', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(t.base + '/api/bookings', { method: 'OPTIONS', headers: { Origin: 'https://mysite.netlify.app', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /Content-Type/i);
  const adm = await fetch(t.base + '/api/admin/session', { headers: { Origin: 'https://mysite.netlify.app' } });
  assert.equal(adm.headers.get('access-control-allow-origin'), null);
  const post = await fetch(t.base + '/api/bookings', { method: 'POST', headers: { Origin: 'https://mysite.netlify.app', 'Content-Type': 'application/json' }, body: JSON.stringify({ botcheck: true }) });
  assert.equal(post.status, 201); assert.equal(post.headers.get('access-control-allow-origin'), 'https://mysite.netlify.app');
  await t.close();
});
