/* The Postgres connector cannot be run here (no Postgres server). This test checks its control flow against a stand-in
   "pg" module: placeholder conversion, transaction order, per-unit advisory lock, rollback on error, BIGINT parsing.
   It does NOT prove it works against a real Postgres - see README "Not verified". */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const calls = []; let failOn = null; let parserSet = null;
class FakeClient { async query(sql, p) { calls.push([sql.replace(/\s+/g, ' ').trim(), p]); if (failOn && sql.includes(failOn)) throw new Error('boom'); return { rows: [{ ok: 1 }], rowCount: 1 }; } release() { calls.push(['release']); } }
class FakePool { constructor(o) { this.o = o; } on() {} async query(s, p) { return new FakeClient().query(s, p); } async connect() { return new FakeClient(); } async end() {} }
const fakePg = { Pool: FakePool, types: { setTypeParser: (oid, fn) => { parserSet = [oid, fn]; } } };
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'pg' ? fakePg : orig.call(this, req, ...rest); };
const { createPg, createAdapter } = require('../lib/db'); // the stand-in stays active for this whole file (each test file runs in its own process)

test('pg adapter: ? becomes $1,$2,... and BIGINT is parsed to a number', async () => {
  const a = createPg('postgres://x'); calls.length = 0;
  await a.all('SELECT * FROM bookings WHERE unit_id=? AND check_in<? AND check_out>?', ['1', 'b', 'c']);
  assert.equal(calls[0][0], 'SELECT * FROM bookings WHERE unit_id=$1 AND check_in<$2 AND check_out>$3');
  assert.deepEqual(parserSet[0], 20); assert.equal(parserSet[1]('1234567890123'), 1234567890123);
  assert.match(a.ddl('id {PK}, t {BIGINT}'), /SERIAL PRIMARY KEY, t BIGINT/);
});
test('pg adapter: transaction = BEGIN, advisory lock, work, COMMIT, release; ROLLBACK on error', async () => {
  const a = createPg('postgres://x'); calls.length = 0;
  await a.tx(async t => { await t.all('SELECT 1 WHERE a=?', [1]); }, 'unit:595');
  assert.deepEqual(calls.map(c => c[0]), ['BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))', 'SELECT 1 WHERE a=$1', 'COMMIT', 'release']);
  assert.deepEqual(calls[1][1], ['unit:595']);
  calls.length = 0; failOn = 'explode';
  await assert.rejects(a.tx(async t => { await t.run('explode ?', [1]); }, 'unit:1'), /boom/);
  failOn = null;
  assert.deepEqual(calls.map(c => c[0]).filter(x => ['BEGIN', 'ROLLBACK', 'COMMIT', 'release'].includes(x)), ['BEGIN', 'ROLLBACK', 'release']);
});
test('adapter choice: DATABASE_URL wins; on Vercel without it, refuse instead of using a temporary disk', () => {
  assert.equal(createAdapter({ DATABASE_URL: 'postgres://x', VERCEL: '1' }).kind, 'pg');
  assert.throws(() => createAdapter({ VERCEL: '1' }), /DATABASE_URL/);
});
