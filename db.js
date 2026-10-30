/* Database adapters. They are deliberately tiny: ALL SQL lives in lib/store.js and is written to run on both.
   An adapter provides:  kind, ddl(sql), all(sql,params), run(sql,params), tx(fn, lockKey), close()
   SQL uses "?" placeholders; the Postgres adapter converts them to $1, $2, ... */
const path = require('path');
const fs = require('fs');

class ConfigError extends Error { constructor(m) { super(m); this.name = 'ConfigError'; } }

function createSqlite(file) {
  const { DatabaseSync } = require('node:sqlite'); // built in to Node 22+
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const ddl = s => s.replace(/\{PK\}/g, 'INTEGER PRIMARY KEY AUTOINCREMENT').replace(/\{BIGINT\}/g, 'INTEGER');
  const all = (sql, p) => db.prepare(sql).all(...(p || []));
  const run = (sql, p) => ({ changes: Number(db.prepare(sql).run(...(p || [])).changes) });
  // one connection: serialise everything so a transaction is never interleaved with other statements
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  return {
    kind: 'sqlite', ddl,
    all: (sql, p) => serial(() => all(sql, p)),
    run: (sql, p) => serial(() => run(sql, p)),
    tx: fn => serial(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn({ all: async (s, p) => all(s, p), run: async (s, p) => run(s, p) });
        db.exec('COMMIT'); return r;
      } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
    }),
    close: async () => db.close()
  };
}

function createPg(url) {
  let pg; try { pg = require('pg'); } catch (e) { throw new ConfigError('The "pg" package is not installed. Run: npm install'); }
  pg.types.setTypeParser(20, v => parseInt(v, 10)); // BIGINT -> number
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
  pool.on('error', () => {}); // an idle client dropping must not crash the function
  const conv = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  const ddl = s => s.replace(/\{PK\}/g, 'SERIAL PRIMARY KEY').replace(/\{BIGINT\}/g, 'BIGINT');
  return {
    kind: 'pg', ddl,
    all: async (sql, p) => (await pool.query(conv(sql), p || [])).rows,
    run: async (sql, p) => ({ changes: (await pool.query(conv(sql), p || [])).rowCount }),
    tx: async (fn, lockKey) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        if (lockKey) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]); // serialises writers per key
        const r = await fn({ all: async (s, p) => (await c.query(conv(s), p || [])).rows, run: async (s, p) => ({ changes: (await c.query(conv(s), p || [])).rowCount }) });
        await c.query('COMMIT'); return r;
      } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
      finally { c.release(); }
    },
    close: async () => pool.end()
  };
}

function createAdapter(env) {
  if (env.DATABASE_URL) return createPg(env.DATABASE_URL);
  // On Render (and Vercel) the disk is temporary: a SQLite file there would silently lose every booking. Refuse instead.
  if (env.VERCEL || env.RENDER) throw new ConfigError('DATABASE_URL is not set. Bookings cannot be stored. See README step 2.');
  return createSqlite(env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'dev.db'));
}

module.exports = { createAdapter, createSqlite, createPg, ConfigError };
