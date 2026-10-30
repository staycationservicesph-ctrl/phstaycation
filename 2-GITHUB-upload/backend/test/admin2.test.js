/* 2-step login, rooms/units management, availability on/off, activity log. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createSqlite } = require('../lib/db');
const { createStore } = require('../lib/store');
const { createMailer } = require('../lib/email');
const { createApp } = require('../lib/router');
const auth = require('../lib/auth');

const PASSWORD = 'correct horse battery';
const TOTP = auth.generateTotpSecret();

async function boot(extra) {
  const clock = { t: Date.parse('2026-10-28T02:00:00Z') };
  const env = Object.assign({ SESSION_SECRET: 'x'.repeat(40), ADMIN_PASSWORD: PASSWORD, EMAIL_PROVIDER: 'none' }, extra);
  const store = createStore(createSqlite(':memory:'), env);
  const app = createApp({ store, mailer: createMailer(env), env, now: () => clock.t, log: { error() {} } });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, path, body, headers) => {
    const r = await fetch(base + path, { method, headers: Object.assign({ Origin: base }, body !== undefined ? { 'Content-Type': 'application/json' } : {}, headers || {}), body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j, headers: r.headers };
  };
  const t = { clock, call, base, close: () => new Promise(r => server.close(r)) };
  t.login = async (code) => { const r = await call('POST', '/api/admin/login', { password: PASSWORD, code }); return r; };
  t.cookieOf = r => r.headers.get('set-cookie').split(';')[0];
  t.admin = (cookie, method, path, body) => call(method, path, body, { Cookie: cookie });
  return t;
}

test('2-step OFF: password only works as before, and the session says 2-step is off', async () => {
  const t = await boot({});
  assert.equal((await t.call('GET', '/api/admin/session')).body.twofa, false);
  assert.equal((await t.login()).status, 200);
  await t.close();
});

test('2-step ON: password alone is refused; right password + current code works; same code cannot be reused', async () => {
  const t = await boot({ ADMIN_TOTP_SECRET: TOTP });
  assert.equal((await t.call('GET', '/api/admin/session')).body.twofa, true);
  const noCode = await t.login();
  assert.equal(noCode.status, 401); assert.equal(noCode.body.error, 'wrong_login');
  assert.equal((await t.login('123456')).status, 401);
  const code = auth.totpCode(TOTP, t.clock.t);
  const ok = await t.login(code);
  assert.equal(ok.status, 200); assert.ok(ok.headers.get('set-cookie'));
  const again = await t.login(code);
  assert.equal(again.status, 401, 'a code is single-use');
  await t.close();
});

test('2-step ON: wrong password with a valid code is refused with the same generic error; clock drift of one step is accepted, two is not', async () => {
  const t = await boot({ ADMIN_TOTP_SECRET: TOTP });
  const code = auth.totpCode(TOTP, t.clock.t);
  const r = await t.call('POST', '/api/admin/login', { password: 'wrong wrong wrong', code });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'wrong_login');
  assert.equal((await t.login(auth.totpCode(TOTP, t.clock.t - 30000))).status, 200); // previous step: phone slightly slow
  assert.equal((await t.login(auth.totpCode(TOTP, t.clock.t + 90000))).status, 401); // 3 steps ahead: refused
  await t.close();
});

test('2-step ON: guessing codes is limited', async () => {
  const t = await boot({ ADMIN_TOTP_SECRET: TOTP });
  const seen = new Set();
  for (let i = 0; i < 8; i++) seen.add((await t.login(String(100000 + i))).status);
  assert.deepEqual([...seen], [401]);
  assert.equal((await t.login(auth.totpCode(TOTP, t.clock.t))).status, 429, 'locked out after 8 tries, even with the right code');
  await t.close();
});

test('an invalid ADMIN_TOTP_SECRET stops admin login (fails closed)', async () => {
  const t = await boot({ ADMIN_TOTP_SECRET: 'not a key!!' });
  assert.equal((await t.login('123456')).status, 503);
  await t.close();
});

test('rooms: add, validate, duplicates, edit, switch off/on, last unit protected; public site follows', async () => {
  const t = await boot({});
  const cookie = t.cookieOf(await t.login());
  const good = { id: 'A101', tower: 'Test Tower', beds: 'Queen Bed', desc: 'Nice', perks: 'Netflix', base: 2, max: 3, extra: 300, weekday: 2500, weekend: 3000 };
  // visitors cannot
  for (const p of ['units-add', 'units-update', 'units-active']) assert.equal((await t.call('POST', '/api/admin/' + p, good)).status, 401);
  assert.equal((await t.call('GET', '/api/admin/audit')).status, 401);
  // validation
  const bad = async o => (await t.admin(cookie, 'POST', '/api/admin/units-add', Object.assign({}, good, o)));
  for (const o of [{ id: 'has space' }, { id: '' }, { id: '<b>' }, { id: 'x'.repeat(16) }, { tower: ' ' }, { beds: '' }, { base: 0 }, { base: 5 }, { max: 1, base: 2 }, { max: 9 }, { extra: -1 }, { weekday: 0 }, { weekend: 'a' }, { weekday: 1.5 }]) {
    const r = await bad(o); assert.equal(r.status, 422, JSON.stringify(o)); assert.ok(r.body.fields);
  }
  assert.equal((await bad({})).status, 201);
  assert.equal((await bad({ id: 'a101' })).status, 409, 'duplicate id, any letter case');
  assert.equal((await bad({ id: '595' })).status, 409, 'existing unit');
  const pub = (await t.call('GET', '/api/units')).body.units;
  const u = pub.find(x => x.id === 'A101');
  assert.ok(u && u.price === 2500 && u.weekend === 3000 && u.max === 3 && u.base === 2 && u.extra === 300);
  assert.equal(pub[pub.length - 1].id, 'A101', 'new unit is listed last');
  assert.equal('active' in u, false);
  // text is stored as plain text (HTML is escaped by the pages; here we only check it is trimmed/cleaned)
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-update', { id: 'A101', tower: '  New   Tower\n', beds: 'King', desc: '', perks: '', base: 1, max: 4, extra: 0 })).status, 200);
  const after = (await t.call('GET', '/api/units')).body.units.find(x => x.id === 'A101');
  assert.equal(after.tower, 'New Tower'); assert.equal(after.max, 4); assert.equal(after.price, 2500, 'rates untouched by an edit');
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-update', { id: 'nope', tower: 'x', beds: 'x', base: 1, max: 1, extra: 0 })).status, 404);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-update', { id: 'A101', tower: 'x', beds: 'x', base: 3, max: 2, extra: 0 })).status, 422);
  // availability on/off
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-active', { id: 'A101', active: false })).status, 200);
  assert.equal((await t.call('GET', '/api/units')).body.units.some(x => x.id === 'A101'), false, 'hidden from guests');
  const adm = (await t.admin(cookie, 'GET', '/api/admin/units')).body.units.find(x => x.id === 'A101');
  assert.equal(adm.active, false, 'still visible to the host');
  const book = { unit: 'A101', ci: '2026-11-10', co: '2026-11-12', guests: 2, name: 'Test Guest', phone: '0917 123 4567', email: 'g@example.com', rules: true };
  assert.ok([404, 422].includes((await t.call('POST', '/api/bookings', book, { 'X-Forwarded-For': '10.1.1.1' })).status), 'cannot be booked while off');
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-active', { id: 'A101', active: true })).status, 200);
  assert.equal((await t.call('POST', '/api/bookings', book, { 'X-Forwarded-For': '10.1.1.2' })).status, 201, 'bookable again');
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-active', { id: 'A101', active: 'yes' })).status, 422);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/units-active', { id: 'zzz', active: false })).status, 404);
  // the last active unit cannot be switched off
  const ids = (await t.call('GET', '/api/units')).body.units.map(x => x.id);
  let last = 0; for (const id of ids) { const r = await t.admin(cookie, 'POST', '/api/admin/units-active', { id, active: false }); if (r.status === 409) { last++; assert.equal(r.body.error, 'last_unit'); } }
  assert.equal(last, 1);
  assert.ok((await t.call('GET', '/api/units')).body.units.length >= 1);
  await t.close();
});

test('activity log records important actions, never secrets, and needs login', async () => {
  const t = await boot({ ADMIN_TOTP_SECRET: TOTP });
  await t.login('000000');
  const r = await t.login(auth.totpCode(TOTP, t.clock.t));
  const cookie = t.cookieOf(r);
  await t.admin(cookie, 'POST', '/api/admin/rates', { unit: '595', weekday: 2100, weekend: 2600, extra: 0 });
  await t.admin(cookie, 'POST', '/api/admin/units-add', { id: 'Z9', tower: 'T', beds: 'B', desc: '', perks: '', base: 1, max: 2, extra: 0, weekday: 1000, weekend: 1200 });
  const log = (await t.admin(cookie, 'GET', '/api/admin/audit')).body.log;
  const actions = log.map(x => x.action);
  for (const a of ['login_failed', 'login_ok', 'rates_changed', 'unit_added']) assert.ok(actions.includes(a), a);
  const rc = log.find(x => x.action === 'rates_changed').detail;
  assert.match(rc, /1999\/1999\/0 -> 2100\/2600\/0/);
  const dump = JSON.stringify(log);
  assert.equal(dump.includes(PASSWORD), false); assert.equal(dump.includes(TOTP), false);
  await t.close();
});
