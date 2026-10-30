/* Admin authentication. No dependencies: Node's crypto only.
   - Password is compared in constant time (sha256 of both sides, then timingSafeEqual).
   - ADMIN_PASSWORD_HASH (scrypt, made by scripts/hash-password.js) is supported and preferred.
   - Session = signed token (HMAC-SHA256) in an HttpOnly, SameSite=Strict cookie. */
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function verifyPassword(input, env) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 200) return false;
  if (env.ADMIN_PASSWORD_HASH) {
    // format: scrypt$N$saltBase64$hashBase64
    const [alg, N, salt, hash] = String(env.ADMIN_PASSWORD_HASH).split('$');
    if (alg !== 'scrypt' || !N || !salt || !hash) return false;
    try {
      const want = Buffer.from(hash, 'base64');
      const got = crypto.scryptSync(input, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      return got.length === want.length && crypto.timingSafeEqual(got, want);
    } catch (e) { return false; }
  }
  if (env.ADMIN_PASSWORD) return safeEq(input, env.ADMIN_PASSWORD);
  return false;
}

function hashPassword(pw) {
  const N = 16384, salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N, r: 8, p: 1 });
  return ['scrypt', N, salt.toString('base64'), hash.toString('base64')].join('$');
}

/* Admin login is only offered when it is configured safely. */
function adminConfigProblem(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return 'SESSION_SECRET must be at least 32 characters.';
  if (!env.ADMIN_PASSWORD_HASH && !(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 12)) return 'Set ADMIN_PASSWORD (12+ characters) or ADMIN_PASSWORD_HASH.';
  return null;
}

function signSession(secret, nowMs, ttlMs) {
  const payload = b64u(JSON.stringify({ v: 1, iat: nowMs, exp: nowMs + ttlMs, n: crypto.randomBytes(8).toString('hex') }));
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySession(token, secret, nowMs) {
  if (typeof token !== 'string' || token.length > 400 || !secret) return false;
  const i = token.indexOf('.');
  if (i < 1) return false;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const want = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString()); return p.v === 1 && typeof p.exp === 'number' && p.exp > nowMs; } catch (e) { return false; }
}

function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
const hashIp = (ip, secret) => crypto.createHmac('sha256', secret || 'dev').update(String(ip || 'unknown')).digest('hex').slice(0, 32);

module.exports = { verifyPassword, hashPassword, adminConfigProblem, signSession, verifySession, parseCookies, hashIp };
