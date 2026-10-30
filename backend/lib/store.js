/* The only place that contains SQL. Portable between SQLite and Postgres.
   Dates are TEXT 'YYYY-MM-DD' (ISO strings sort correctly). Times are epoch milliseconds.
   Double-booking protection: every write for a unit runs in a transaction that holds a per-unit lock
   (Postgres advisory lock / SQLite BEGIN IMMEDIATE), re-checks overlap, then inserts. */
const { seedUnits } = require('./units-seed');

const DDL = [
  `CREATE TABLE IF NOT EXISTS units(
     id TEXT PRIMARY KEY, tower TEXT NOT NULL, beds TEXT NOT NULL, description TEXT NOT NULL, perks TEXT NOT NULL,
     base_guests INTEGER NOT NULL, max_guests INTEGER NOT NULL, extra_fee INTEGER NOT NULL DEFAULT 0,
     weekday_rate INTEGER NOT NULL, weekend_rate INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS rate_rules(
     id {PK}, unit_id TEXT, from_date TEXT NOT NULL, to_date TEXT NOT NULL, price INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS bookings(
     id {PK}, code TEXT NOT NULL UNIQUE, unit_id TEXT NOT NULL REFERENCES units(id),
     check_in TEXT NOT NULL, check_out TEXT NOT NULL, guests INTEGER NOT NULL,
     name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending','confirmed','declined','cancelled','blocked')),
     total INTEGER NOT NULL, created_at {BIGINT} NOT NULL, hold_expires {BIGINT},
     notify_ok INTEGER, notify_error TEXT, note TEXT NOT NULL DEFAULT '',
     CHECK (check_out > check_in))`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_unit_dates ON bookings(unit_id, check_in, check_out)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS inquiries(
     id {PK}, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL,
     guests INTEGER NOT NULL, message TEXT NOT NULL DEFAULT '', created_at {BIGINT} NOT NULL, notify_ok INTEGER, notify_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS rate_limits(k TEXT PRIMARY KEY, window_start {BIGINT} NOT NULL, hits INTEGER NOT NULL)`
];

/* A booking "holds" its dates when confirmed, blocked by the host, or pending and not yet expired. */
const ACTIVE = `(status IN ('confirmed','blocked') OR (status='pending' AND hold_expires>?))`;

const rowToUnit = r => ({ id: r.id, tower: r.tower, beds: r.beds, desc: r.description, perks: r.perks, price: r.weekday_rate, weekend: r.weekend_rate, base: r.base_guests, max: r.max_guests, extra: r.extra_fee, active: !!r.active });
const rowToBooking = (r, now) => ({ id: r.id, code: r.code, unit: r.unit_id, ci: r.check_in, co: r.check_out, guests: r.guests, name: r.name, phone: r.phone, email: r.email, status: r.status, total: r.total, createdAt: r.created_at, holdExpires: r.hold_expires, expired: r.status === 'pending' && r.hold_expires != null && r.hold_expires <= now, notifyOk: r.notify_ok == null ? null : !!r.notify_ok, notifyError: r.notify_error, note: r.note });

function createStore(adapter, env) {
  let readyP = null;

  function ready() {
    if (!readyP) {
      readyP = adapter.tx(async t => {
        for (const s of DDL) await t.run(adapter.ddl(s));
        const n = (await t.all('SELECT COUNT(*) AS n FROM units'))[0].n;
        if (Number(n) === 0) {
          let i = 0;
          for (const u of seedUnits(env || {})) {
            await t.run('INSERT INTO units(id,tower,beds,description,perks,base_guests,max_guests,extra_fee,weekday_rate,weekend_rate,active,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)',
              [u.id, u.tower, u.beds, u.desc, u.perks, u.base, u.max, u.extra, u.price, u.weekend, i++]);
          }
        }
      }, 'schema-init').catch(e => { readyP = null; throw e; }); // retry on the next request if it failed
    }
    return readyP;
  }

  const overlapSql = (excludeId) =>
    `SELECT id FROM bookings WHERE unit_id=? AND check_in<? AND check_out>?${excludeId != null ? ' AND id<>?' : ''} AND ${ACTIVE} LIMIT 1`;
  const overlapParams = (unit, ci, co, now, excludeId) => excludeId != null ? [unit, co, ci, excludeId, now] : [unit, co, ci, now];

  return {
    ready,

    async getUnits({ all } = {}) {
      const rows = await adapter.all(`SELECT * FROM units ${all ? '' : 'WHERE active=1'} ORDER BY sort_order, id`);
      return rows.map(rowToUnit);
    },
    async getRules() {
      const rows = await adapter.all('SELECT id, unit_id, from_date, to_date, price, label FROM rate_rules ORDER BY id');
      return rows.map(r => ({ id: r.id, unit: r.unit_id || 'all', from: r.from_date, to: r.to_date, price: r.price, label: r.label }));
    },

    /* Dates held by someone else, in a window. Contains NO personal data. */
    async getBusy(from, to, now) {
      return adapter.all(`SELECT unit_id AS unit, check_in AS ci, check_out AS co, status FROM bookings WHERE check_in<? AND check_out>? AND ${ACTIVE} ORDER BY check_in`, [to, from, now]);
    },

    /* rec: {code,unit,ci,co,guests,name,phone,email,status,total,holdExpires,note}  ->  {ok:true,id} | {ok:false,reason:'conflict'|'code'} */
    async createBooking(rec, now) {
      return adapter.tx(async t => {
        if ((await t.all(overlapSql(), overlapParams(rec.unit, rec.ci, rec.co, now))).length) return { ok: false, reason: 'conflict' };
        if ((await t.all('SELECT id FROM bookings WHERE code=?', [rec.code])).length) return { ok: false, reason: 'code' };
        const r = await t.all('INSERT INTO bookings(code,unit_id,check_in,check_out,guests,name,phone,email,status,total,created_at,hold_expires,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',
          [rec.code, rec.unit, rec.ci, rec.co, rec.guests, rec.name, rec.phone, rec.email, rec.status, rec.total, now, rec.holdExpires == null ? null : rec.holdExpires, rec.note || '']);
        return { ok: true, id: r[0].id };
      }, 'unit:' + rec.unit);
    },

    async getBooking(id, now) {
      const r = await adapter.all('SELECT * FROM bookings WHERE id=?', [id]);
      return r.length ? rowToBooking(r[0], now) : null;
    },
    async listBookings({ status, limit }, now) {
      const where = status && status !== 'all' ? 'WHERE status=?' : '';
      const rows = await adapter.all(`SELECT * FROM bookings ${where} ORDER BY created_at DESC LIMIT ?`, status && status !== 'all' ? [status, limit || 300] : [limit || 300]);
      return rows.map(r => rowToBooking(r, now));
    },

    /* action: confirm | decline | cancel  ->  {ok:true,booking} | {ok:false,reason:'notfound'|'state'|'conflict'} */
    async transition(id, action, now) {
      const first = await adapter.all('SELECT unit_id FROM bookings WHERE id=?', [id]);
      if (!first.length) return { ok: false, reason: 'notfound' };
      return adapter.tx(async t => {
        const rows = await t.all('SELECT * FROM bookings WHERE id=?', [id]);
        if (!rows.length) return { ok: false, reason: 'notfound' };
        const b = rows[0];
        let to = null;
        if (action === 'confirm' && b.status === 'pending') to = 'confirmed';
        else if (action === 'decline' && b.status === 'pending') to = 'declined';
        else if (action === 'cancel' && ['pending', 'confirmed', 'blocked'].includes(b.status)) to = 'cancelled';
        if (!to) return { ok: false, reason: 'state' };
        if (to === 'confirmed' && (await t.all(overlapSql(id), overlapParams(b.unit_id, b.check_in, b.check_out, now, id))).length) return { ok: false, reason: 'conflict' };
        await t.run('UPDATE bookings SET status=?, hold_expires=? WHERE id=?', [to, null, id]);
        const upd = await t.all('SELECT * FROM bookings WHERE id=?', [id]);
        return { ok: true, booking: rowToBooking(upd[0], now) };
      }, 'unit:' + first[0].unit_id);
    },

    async setNotify(table, id, ok, err) {
      if (table !== 'bookings' && table !== 'inquiries') throw new Error('bad table');
      await adapter.run(`UPDATE ${table} SET notify_ok=?, notify_error=? WHERE id=?`, [ok ? 1 : 0, ok ? null : String(err || 'failed').slice(0, 200), id]);
    },

    async updateRates(unitId, { weekday, weekend, extra }) {
      return (await adapter.run('UPDATE units SET weekday_rate=?, weekend_rate=?, extra_fee=? WHERE id=?', [weekday, weekend, extra, unitId])).changes;
    },
    async addRule({ unit, from, to, price, label }) {
      const r = await adapter.all('INSERT INTO rate_rules(unit_id,from_date,to_date,price,label) VALUES(?,?,?,?,?) RETURNING id', [unit === 'all' ? null : unit, from, to, price, label || '']);
      return r[0].id;
    },
    async deleteRule(id) { return (await adapter.run('DELETE FROM rate_rules WHERE id=?', [id])).changes; },

    async addInquiry(rec, now) {
      const r = await adapter.all('INSERT INTO inquiries(name,phone,email,check_in,check_out,guests,message,created_at) VALUES(?,?,?,?,?,?,?,?) RETURNING id', [rec.name, rec.phone, rec.email, rec.ci, rec.co, rec.guests, rec.message, now]);
      return r[0].id;
    },
    async listInquiries(limit) {
      const rows = await adapter.all('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT ?', [limit || 100]);
      return rows.map(r => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, ci: r.check_in, co: r.check_out, guests: r.guests, message: r.message, createdAt: r.created_at, notifyOk: r.notify_ok == null ? null : !!r.notify_ok }));
    },

    /* Fixed-window rate limit shared by all server instances. -> {allowed, retryAfterSec} */
    async hit(key, windowMs, max, now) {
      const r = await adapter.all(
        `INSERT INTO rate_limits(k,window_start,hits) VALUES(?,?,1)
         ON CONFLICT(k) DO UPDATE SET
           window_start=CASE WHEN ?-rate_limits.window_start>=? THEN ? ELSE rate_limits.window_start END,
           hits=CASE WHEN ?-rate_limits.window_start>=? THEN 1 ELSE rate_limits.hits+1 END
         RETURNING window_start, hits`,
        [key, now, now, windowMs, now, now, windowMs]);
      if (Math.random() < 0.02) adapter.run('DELETE FROM rate_limits WHERE window_start<?', [now - 86400000]).catch(() => {});
      const { window_start, hits } = r[0];
      return { allowed: Number(hits) <= max, retryAfterSec: Math.max(1, Math.ceil((Number(window_start) + windowMs - now) / 1000)) };
    },

    close: () => adapter.close()
  };
}

module.exports = { createStore, DDL };
