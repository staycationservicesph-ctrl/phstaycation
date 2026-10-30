const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const core = require('../lib/core.js');
const { createSqlite } = require('../lib/db');
const { createStore } = require('../lib/store');
const { createMailer } = require('../lib/email');
const { createApp } = require('../lib/router');
const auth = require('../lib/auth');

const PASSWORD = 'correct horse battery';
const HOUR = 3600e3;

async function boot(opts = {}) {
  const clock = { t: Date.parse('2026-10-28T02:00:00Z') }; // = 10:00 on 28 Oct 2026 in Manila
  const env = Object.assign({ SESSION_SECRET: 'x'.repeat(40), ADMIN_PASSWORD: PASSWORD, EMAIL_PROVIDER: 'web3forms', WEB3FORMS_ACCESS_KEY: 'test-key', DEFAULT_WEEKDAY_RATE: '1999', DEFAULT_WEEKEND_RATE: '2499' }, opts.env || {});
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (opts.mailFail) return { ok: false, status: 500, json: async () => ({ success: false }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const store = opts.store || createStore(createSqlite(':memory:'), env);
  const app = createApp({ store, mailer: createMailer(env, fakeFetch), env, now: () => clock.t, log: { error() {} } });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, path, body, headers) => {
    const r = await fetch(base + path, { method, headers: Object.assign({}, body !== undefined ? { 'Content-Type': 'application/json' } : {}, headers || {}), body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j, headers: r.headers };
  };
  const t = { clock, sent, store, call, base, env, close: () => new Promise(r => server.close(r)) };
  t.login = async () => { const r = await call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: base }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; };
  t.admin = async (cookie, method, path, body) => call(method, path, body, { Origin: base, Cookie: cookie });
  return t;
}
const BOOK = { unit: '595', ci: '2026-11-10', co: '2026-11-12', guests: 2, name: 'Test Guest', phone: '0917 123 4567', email: 'g@example.com', rules: true };
let ipn = 0; const freshIp = () => ({ 'X-Forwarded-For': '10.0.' + Math.floor(++ipn / 250) + '.' + (ipn % 250) });

test('public: units and availability', async () => {
  const t = await boot();
  const u = await t.call('GET', '/api/units');
  assert.equal(u.status, 200); assert.equal(u.body.units.length, 14);
  assert.ok(!('active' in u.body.units[0]));
  assert.deepEqual(Object.keys(u.body.units[0]).sort(), ['base', 'beds', 'desc', 'extra', 'id', 'max', 'perks', 'price', 'tower', 'weekend']);
  const a = await t.call('GET', '/api/availability?from=2026-10-28&to=2027-01-01');
  assert.equal(a.status, 200); assert.deepEqual(a.body.busy, []);
  assert.equal((await t.call('GET', '/api/availability?from=bad&to=2027-01-01')).status, 422);
  assert.equal((await t.call('GET', '/api/availability?from=2027-01-01&to=2026-01-01')).status, 422);
  await t.close();
});

test('booking: saved, priced by the SERVER, host emailed, dates held, no personal data in availability', async () => {
  const t = await boot();
  const r = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { total: 1, price: 1, weekend: 1, status: 'confirmed' }));
  assert.equal(r.status, 201);
  assert.match(r.body.code, /^MP-[A-Z2-9]{6}$/);
  assert.equal(r.body.total, 2 * 1999); assert.equal(r.body.status, 'pending'); assert.equal(r.body.nights, 2);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].url, 'https://api.web3forms.com/submit');
  assert.equal(t.sent[0].body.access_key, 'test-key'); assert.equal(t.sent[0].body.Reference, r.body.code); assert.equal(t.sent[0].body.name, 'Test Guest');
  const rows = await t.store.listBookings({ status: 'all' }, t.clock.t);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].notifyOk, true); assert.equal(rows[0].total, 3998);
  const a = await t.call('GET', '/api/availability?from=2026-10-28&to=2027-01-01');
  assert.deepEqual(a.body.busy, [{ unit: '595', ci: '2026-11-10', co: '2026-11-12', status: 'pending' }]);
  assert.ok(!JSON.stringify(a.body).includes('Test Guest') && !JSON.stringify(a.body).includes('example.com'));
  await t.close();
});

test('pricing: weekend nights, extra guests and special rates match the shared core', async () => {
  const t = await boot();
  const cookie = await t.login();
  const wk = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1407', ci: '2026-11-12', co: '2026-11-16', guests: 4 }), freshIp());
  // Thu(wd) Fri(we) Sat(we) Sun(wd) = 2*1999 + 2*2499 ; 2 extra guests * 300 * 4 nights
  assert.equal(wk.body.total, 2 * 1999 + 2 * 2499 + 2 * 300 * 4);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/rules', { unit: 'all', from: '2026-12-24', to: '2026-12-26', price: 3499, label: 'Christmas' })).status, 201);
  const xm = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '855', ci: '2026-12-24', co: '2026-12-26' }), freshIp());
  assert.equal(xm.body.total, 2 * 3499);
  const rules = await t.store.getRules(); const u = (await t.store.getUnits()).find(x => x.id === '855');
  assert.equal(core.quote(u, '2026-12-24', '2026-12-26', 2, rules).total, xm.body.total);
  await t.close();
});

test('validation rejects bad input with field messages', async () => {
  const t = await boot();
  const bad = [
    ['past check-in', { ci: '2026-10-27', co: '2026-10-29' }, 'dates'], ['checkout before checkin', { ci: '2026-11-12', co: '2026-11-10' }, 'dates'],
    ['same day', { ci: '2026-11-10', co: '2026-11-10' }, 'dates'], ['61 nights', { ci: '2026-11-10', co: '2027-01-10' }, 'dates'],
    ['impossible date', { ci: '2026-02-30', co: '2026-03-02' }, 'dates'], ['too far ahead', { ci: '2029-01-01', co: '2029-01-03' }, 'dates'],
    ['5 guests', { guests: 5 }, 'guests'], ['0 guests', { guests: 0 }, 'guests'], ['guests as text', { guests: '2' }, 'guests'], ['fractional guests', { guests: 1.5 }, 'guests'],
    ['short name', { name: 'A' }, 'name'], ['long name', { name: 'A'.repeat(81) }, 'name'], ['phone letters', { phone: 'call me maybe' }, 'phone'], ['short phone', { phone: '12345' }, 'phone'],
    ['bad email', { email: 'nope' }, 'email'], ['email with angle brackets', { email: 'a<b>@x.co' }, 'email'], ['rules false', { rules: false }, 'rules'], ['rules missing', { rules: undefined }, 'rules'],
    ['unknown unit', { unit: '9999' }, 'unit'], ['unit as object', { unit: { $ne: 1 } }, 'unit'], ['unit as number', { unit: 595 }, 'unit']
  ];
  for (const [label, over, field] of bad) {
    const r = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, over), freshIp());
    assert.equal(r.status, 422, label); assert.ok(r.body.fields[field], label + ' -> field ' + field);
  }
  assert.equal((await t.store.listBookings({ status: 'all' }, t.clock.t)).length, 0);
  await t.close();
});

test('double booking is impossible: overlap -> 409, same-day turnover allowed, 20 parallel requests -> exactly one winner', async () => {
  const t = await boot();
  assert.equal((await t.call('POST', '/api/bookings', BOOK, freshIp())).status, 201);
  assert.equal((await t.call('POST', '/api/bookings', BOOK, freshIp())).status, 409);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { ci: '2026-11-11', co: '2026-11-13' }), freshIp())).status, 409); // overlaps one night
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { ci: '2026-11-09', co: '2026-11-13' }), freshIp())).status, 409); // wraps around
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { ci: '2026-11-12', co: '2026-11-14' }), freshIp())).status, 201); // arrives the day the first leaves
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { ci: '2026-11-08', co: '2026-11-10' }), freshIp())).status, 201); // leaves the day the first arrives
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1537' }), freshIp())).status, 201); // other unit unaffected
  const race = await Promise.all(Array.from({ length: 20 }, (_, i) => t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1583', name: 'Racer ' + i }), freshIp())));
  assert.equal(race.filter(r => r.status === 201).length, 1);
  assert.equal(race.filter(r => r.status === 409).length, 19);
  assert.equal((await t.store.listBookings({ status: 'all' }, t.clock.t)).filter(b => b.unit === '1583').length, 1);
  await t.close();
});

test('pending holds expire after 24h, confirmed bookings do not', async () => {
  const t = await boot();
  const cookie = await t.login();
  const p = await t.call('POST', '/api/bookings', BOOK, freshIp());
  const c = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1537' }), freshIp());
  const list = (await t.admin(cookie, 'GET', '/api/admin/bookings')).body.bookings;
  const cid = list.find(b => b.code === c.body.code).id;
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/booking-action', { id: cid, action: 'confirm' })).status, 200);
  t.clock.t += 25 * HOUR;
  const a = await t.call('GET', '/api/availability?from=2026-10-28&to=2027-01-01');
  assert.deepEqual(a.body.busy.map(b => b.unit), ['1537']); // pending 595 released, confirmed 1537 kept
  assert.equal((await t.call('POST', '/api/bookings', BOOK, freshIp())).status, 201); // the released dates can be booked again
  t.clock.t += 400 * HOUR;
  assert.equal((await t.call('GET', '/api/availability?from=2026-10-28&to=2027-01-01')).body.busy.some(b => b.unit === '1537'), true);
  await t.close();
});

test('rate limits: bookings per IP, then allowed again after the window', async () => {
  const t = await boot();
  const ip = { 'X-Forwarded-For': '203.0.113.9' };
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: ['595', '1537', '1567', '1569', '1583', '1585'][i] }), ip)));
  assert.deepEqual(codes.map(r => r.status), [201, 201, 201, 201, 201, 429]);
  assert.ok(Number(codes[5].headers.get('retry-after')) > 0);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1586' }), { 'X-Forwarded-For': '203.0.113.10' })).status, 201); // another visitor is not affected
  t.clock.t += 11 * 60 * 1000;
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1585' }), ip)).status, 201);
  await t.close();
});

test('spam trap, body limits, content type, bad JSON, cross-site requests', async () => {
  const t = await boot();
  const trap = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { botcheck: true }), freshIp());
  assert.equal(trap.status, 201); assert.equal((await t.store.listBookings({ status: 'all' }, t.clock.t)).length, 0); assert.equal(t.sent.length, 0);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { name: 'A'.repeat(25000) }), freshIp())).status, 413);
  assert.equal((await t.call('POST', '/api/bookings', JSON.stringify(BOOK), Object.assign({ 'Content-Type': 'text/plain' }, freshIp()))).status, 415);
  assert.equal((await t.call('POST', '/api/bookings', '{not json', freshIp())).status, 400);
  assert.equal((await t.call('POST', '/api/bookings', '[1,2]', freshIp())).status, 400);
  assert.equal((await t.call('POST', '/api/bookings', BOOK, Object.assign({ Origin: 'https://evil.example' }, freshIp()))).status, 403);
  assert.equal((await t.call('POST', '/api/bookings', BOOK, Object.assign({ Origin: t.base }, freshIp()))).status, 201);
  assert.equal((await t.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await t.call('POST', '/api/admin/login', { password: PASSWORD })).status, 403); // no Origin / Sec-Fetch-Site
  assert.equal((await t.call('GET', '/api/nothing')).status, 404);
  const m = await t.call('GET', '/api/bookings'); assert.equal(m.status, 405); assert.match(m.headers.get('allow'), /POST/);
  await t.close();
});

test('admin auth: every admin endpoint refuses visitors; cookie is HttpOnly + SameSite=Strict; tampering and expiry rejected', async () => {
  const t = await boot();
  const gets = ['/api/admin/bookings', '/api/admin/units', '/api/admin/inquiries'];
  for (const p of gets) assert.equal((await t.call('GET', p)).status, 401, p);
  for (const p of ['booking-action', 'blocks', 'rates', 'rules', 'rules-delete']) assert.equal((await t.call('POST', '/api/admin/' + p, {}, { Origin: t.base })).status, 401, p);
  const wrong = await t.call('POST', '/api/admin/login', { password: 'nope nope nope' }, { Origin: t.base });
  assert.equal(wrong.status, 401); assert.equal(wrong.headers.get('set-cookie'), null);
  const ok = await t.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: t.base });
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/api\/admin/); assert.match(sc, /Max-Age=28800/); assert.doesNotMatch(sc, /Secure/);
  const cookie = sc.split(';')[0];
  assert.equal((await t.call('GET', '/api/admin/session')).body.authenticated, false);
  assert.equal((await t.call('GET', '/api/admin/session', undefined, { Cookie: cookie })).body.authenticated, true);
  const tampered = cookie.slice(0, -2) + (cookie.endsWith('a') ? 'bb' : 'aa');
  assert.equal((await t.call('GET', '/api/admin/session', undefined, { Cookie: tampered })).body.authenticated, false);
  assert.equal((await t.call('GET', '/api/admin/bookings', undefined, { Cookie: tampered })).status, 401);
  const forged = 'mp_admin=' + auth.signSession('y'.repeat(40), t.clock.t, 1e6);
  assert.equal((await t.call('GET', '/api/admin/bookings', undefined, { Cookie: forged })).status, 401);
  assert.equal((await t.call('GET', '/api/admin/bookings', undefined, { Cookie: 'mp_admin=garbage' })).status, 401);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/rates', { unit: '595', weekday: 1, weekend: 1, extra: 0 })).status, 200);
  assert.equal((await t.call('POST', '/api/admin/rates', { unit: '595', weekday: 1, weekend: 1, extra: 0 }, { Origin: 'https://evil.example', Cookie: cookie })).status, 403); // CSRF
  t.clock.t += 9 * HOUR;
  assert.equal((await t.call('GET', '/api/admin/session', undefined, { Cookie: cookie })).body.authenticated, false); // expired after 8h
  assert.equal((await t.call('GET', '/api/admin/bookings', undefined, { Cookie: cookie })).status, 401);
  const logout = await t.call('POST', '/api/admin/logout', {}, { Origin: t.base });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  await t.close();
  const s = await boot({ env: { VERCEL: '1' } });
  assert.match((await s.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: s.base })).headers.get('set-cookie'), /Secure/);
  await s.close();
});

test('admin login is brute-force limited and refuses to run when misconfigured', async () => {
  const t = await boot();
  for (let i = 0; i < 8; i++) assert.equal((await t.call('POST', '/api/admin/login', { password: 'wrong wrong ' + i }, { Origin: t.base })).status, 401);
  assert.equal((await t.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: t.base })).status, 429); // locked out even with the right password
  t.clock.t += 16 * 60 * 1000;
  assert.equal((await t.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: t.base })).status, 200);
  await t.close();
  for (const env of [{ SESSION_SECRET: 'short' }, { ADMIN_PASSWORD: 'short' }, { SESSION_SECRET: '', ADMIN_PASSWORD: '' }]) {
    const m = await boot({ env });
    assert.equal((await m.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: m.base })).status, 503);
    assert.equal((await m.call('GET', '/api/admin/bookings')).status, 401);
    await m.close();
  }
  const h = await boot({ env: { ADMIN_PASSWORD: '', ADMIN_PASSWORD_HASH: auth.hashPassword('another long password') } });
  assert.equal((await h.call('POST', '/api/admin/login', { password: PASSWORD }, { Origin: h.base })).status, 401);
  assert.equal((await h.call('POST', '/api/admin/login', { password: 'another long password' }, { Origin: h.base })).status, 200);
  await h.close();
});

test('admin workflow: confirm / decline / cancel, state rules, conflict on confirm, guest email', async () => {
  const t = await boot({ env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'rk', MAIL_FROM: 'Manila Prime <b@example.com>', NOTIFY_TO: 'host@example.com' } });
  let cookie = await t.login();
  const mk = async over => (await t.call('POST', '/api/bookings', Object.assign({}, BOOK, over), freshIp())).body.code;
  const idOf = async code => (await t.admin(cookie, 'GET', '/api/admin/bookings')).body.bookings.find(b => b.code === code).id;
  const act = async (code, action) => t.admin(cookie, 'POST', '/api/admin/booking-action', { id: await idOf(code), action });
  const c1 = await mk({});
  assert.equal(t.sent[0].url, 'https://api.resend.com/emails'); assert.deepEqual(t.sent[0].body.to, ['host@example.com']);
  let r = await act(c1, 'confirm');
  assert.equal(r.status, 200); assert.equal(r.body.booking.status, 'confirmed'); assert.equal(r.body.guestMail, 'sent');
  const guestMail = t.sent[t.sent.length - 1]; assert.deepEqual(guestMail.body.to, ['g@example.com']); assert.match(guestMail.body.text, /confirmed/); assert.match(guestMail.body.text, new RegExp(c1));
  assert.equal((await act(c1, 'confirm')).status, 409); assert.equal((await act(c1, 'decline')).status, 409); // already confirmed
  assert.equal((await t.call('GET', '/api/availability?from=2026-10-28&to=2027-01-01')).body.busy[0].status, 'confirmed');
  r = await act(c1, 'cancel'); assert.equal(r.body.booking.status, 'cancelled');
  assert.deepEqual((await t.call('GET', '/api/availability?from=2026-10-28&to=2027-01-01')).body.busy, []);
  assert.equal((await act(c1, 'cancel')).status, 409);
  const c2 = await mk({}); r = await act(c2, 'decline'); assert.equal(r.body.booking.status, 'declined'); assert.match(t.sent[t.sent.length - 1].body.subject, /About your Manila Prime request/);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/booking-action', { id: 999999, action: 'confirm' })).status, 404);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/booking-action', { id: 'x', action: 'confirm' })).status, 422);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/booking-action', { id: 1, action: 'delete-everything' })).status, 422);
  // conflict on confirm: A expires, B takes the dates, confirming A must now fail
  const a = await mk({ unit: '1567' }); t.clock.t += 25 * HOUR; cookie = await t.login(); const b = await mk({ unit: '1567' });
  assert.equal((await act(a, 'confirm')).status, 409);
  assert.equal((await act(b, 'confirm')).status, 200);
  const web = await boot(); const wc = await web.login(); const w = await web.call('POST', '/api/bookings', BOOK, freshIp());
  const wid = (await web.admin(wc, 'GET', '/api/admin/bookings')).body.bookings[0].id;
  assert.equal((await web.admin(wc, 'POST', '/api/admin/booking-action', { id: wid, action: 'confirm' })).body.guestMail, 'skipped'); // web3forms cannot email guests
  await web.close(); await t.close();
});

test('admin: block dates, rates, special rates', async () => {
  const t = await boot(); const cookie = await t.login();
  const blk = (over) => t.admin(cookie, 'POST', '/api/admin/blocks', Object.assign({ unit: '595', from: '2026-12-01', to: '2026-12-05', note: 'Maintenance' }, over));
  assert.equal((await blk({})).status, 201);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { ci: '2026-12-03', co: '2026-12-04' }), freshIp())).status, 409);
  assert.equal((await blk({ from: '2026-12-04', to: '2026-12-08' })).status, 409);
  assert.equal((await blk({ from: '2026-10-01', to: '2026-10-05' })).status, 422); // past
  assert.equal((await blk({ unit: 'nope' })).status, 422); assert.equal((await blk({ to: '2026-11-01', from: '2026-12-01' })).status, 422);
  const blocked = (await t.admin(cookie, 'GET', '/api/admin/bookings?status=blocked')).body.bookings;
  assert.equal(blocked.length, 1); assert.equal((await t.admin(cookie, 'POST', '/api/admin/booking-action', { id: blocked[0].id, action: 'cancel' })).status, 200);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { ci: '2026-12-03', co: '2026-12-04' }), freshIp())).status, 201);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/rates', { unit: '855', weekday: 1500, weekend: 1800, extra: 0 })).status, 200);
  const q = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '855', ci: '2026-11-12', co: '2026-11-15' }), freshIp()); // Thu Fri Sat
  assert.equal(q.body.total, 1500 + 1800 + 1800);
  assert.equal((await t.call('GET', '/api/units')).body.units.find(u => u.id === '855').price, 1500);
  for (const bad of [{ weekday: 0 }, { weekday: -5 }, { weekday: 1.5 }, { weekday: '1999' }, { weekend: 2e9 }, { extra: -1 }, { unit: 'zzz' }]) assert.equal((await t.admin(cookie, 'POST', '/api/admin/rates', Object.assign({ unit: '855', weekday: 1500, weekend: 1800, extra: 0 }, bad))).status, 422, JSON.stringify(bad));
  await t.admin(cookie, 'POST', '/api/admin/rules', { unit: '1537', from: '2026-11-20', to: '2026-11-21', price: 5000, label: 'Concert' });
  const rules = (await t.admin(cookie, 'GET', '/api/admin/units')).body.rules; assert.equal(rules.length, 1);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1537', ci: '2026-11-20', co: '2026-11-21' }), freshIp())).body.total, 5000);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/rules', { unit: 'all', from: '2026-11-22', to: '2026-11-21', price: 5 })).status, 422);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/rules-delete', { id: rules[0].id })).status, 200);
  assert.equal((await t.call('GET', '/api/units')).body.rules.length, 0);
  await t.close();
});

test('injection attempts are stored as plain text and never executed', async () => {
  const t = await boot(); const cookie = await t.login();
  const nasty = "Robert'); DROP TABLE bookings;-- <script>alert(1)</script>";
  const r = await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { name: nasty.slice(0, 80) }), freshIp());
  assert.equal(r.status, 201);
  const rows = (await t.admin(cookie, 'GET', '/api/admin/bookings')).body.bookings;
  assert.equal(rows.length, 1); assert.equal(rows[0].name, nasty.slice(0, 80));
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: "595' OR '1'='1" }), freshIp())).status, 422);
  assert.equal((await t.admin(cookie, 'GET', "/api/admin/bookings?status=pending' OR 1=1--")).status, 422);
  assert.equal((await t.call('GET', "/api/availability?from=2026-10-28' OR 1=1--&to=2027-01-01")).status, 422);
  assert.equal((await t.admin(cookie, 'POST', '/api/admin/booking-action', { id: '1 OR 1=1', action: 'cancel' })).status, 422);
  assert.equal((await t.call('POST', '/api/bookings', Object.assign({}, BOOK, { unit: '1537', name: 'Line\nBreak\u0000Name' }), freshIp())).status, 201); // control characters are cleaned
  assert.equal((await t.admin(cookie, 'GET', '/api/admin/bookings')).body.bookings.some(b => /[\u0000-\u001f]/.test(b.name)), false);
  await t.close();
});

test('email failure never loses a booking; the dashboard shows it', async () => {
  const t = await boot({ mailFail: true }); const cookie = await t.login();
  const r = await t.call('POST', '/api/bookings', BOOK, freshIp());
  assert.equal(r.status, 201);
  const b = (await t.admin(cookie, 'GET', '/api/admin/bookings')).body.bookings[0];
  assert.equal(b.notifyOk, false); assert.equal(b.notifyError, 'HTTP 500');
  await t.close();
  const none = await boot({ env: { EMAIL_PROVIDER: 'none' } });
  assert.equal((await none.call('POST', '/api/bookings', BOOK, freshIp())).status, 201); assert.equal(none.sent.length, 0);
  await none.close();
  const bad = await boot({ env: { EMAIL_PROVIDER: 'web3forms', WEB3FORMS_ACCESS_KEY: '' } });
  assert.equal((await bad.call('POST', '/api/bookings', BOOK, freshIp())).status, 201);
  await bad.close();
});

test('group inquiries', async () => {
  const t = await boot(); const cookie = await t.login();
  const inq = { name: 'Group Lead', phone: '09171234567', email: 'g@x.co', ci: '2026-11-20', co: '2026-11-22', guests: 8, message: 'Birthday' };
  assert.equal((await t.call('POST', '/api/inquiries', inq, freshIp())).status, 201);
  assert.equal(t.sent.length, 1); assert.equal(t.sent[0].body.Guests, '8');
  for (const over of [{ guests: 4 }, { guests: 101 }, { ci: '2026-01-01' }, { message: 'x'.repeat(1001) }, { email: 'bad' }]) assert.equal((await t.call('POST', '/api/inquiries', Object.assign({}, inq, over), freshIp())).status, 422, JSON.stringify(over));
  assert.equal((await t.call('POST', '/api/inquiries', Object.assign({}, inq, { botcheck: true }), freshIp())).status, 201);
  const l = (await t.admin(cookie, 'GET', '/api/admin/inquiries')).body.inquiries;
  assert.equal(l.length, 1); assert.equal(l[0].guests, 8); assert.equal(l[0].notifyOk, true);
  const ip = { 'X-Forwarded-For': '198.51.100.7' }; const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await t.call('POST', '/api/inquiries', inq, ip)).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  await t.close();
});

test('server errors never leak internals; missing database is a clean 503', async () => {
  const t = await boot();
  t.store.getUnits = async () => { throw new Error('secret connection string postgres://user:pw@host'); };
  const r = await t.call('GET', '/api/units');
  assert.equal(r.status, 500); assert.deepEqual(r.body, { error: 'server_error' });
  await t.close();
  const { createAdapter, ConfigError } = require('../lib/db');
  assert.throws(() => createAdapter({ VERCEL: '1' }), ConfigError); // never fall back to a throw-away disk on Vercel
});

test('shared core: dates and prices are timezone-proof', () => {
  assert.equal(core.addDays('2026-12-31', 1), '2027-01-01'); assert.equal(core.nightsBetween('2026-03-08', '2026-03-09'), 1);
  assert.equal(core.isValidDate('2026-02-29'), false); assert.equal(core.isValidDate('2028-02-29'), true);
  assert.equal(core.manilaToday(Date.parse('2026-10-27T17:00:00Z')), '2026-10-28'); // 01:00 in Manila is already the 28th
  const u = { id: '855', price: 1999, weekend: 2499, base: 4, max: 4, extra: 0 };
  assert.equal(core.quote(u, '2026-09-24', '2026-10-03', 2, []).total, 6 * 1999 + 3 * 2499);
});
