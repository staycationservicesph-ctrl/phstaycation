/* Admin authentication. No dependencies: Node's crypto only.
   - Password is compared in constant time (sha256 of both sides, then timingSafeEqual).
   - ADMIN_PASSWORD_HASH (scrypt, made by scripts/hash-password.js) is supported and preferred.
   - Session = signed token (HMAC-SHA256) in an HttpOnly, SameSite=Strict cookie.
   - 2-step login: ADMIN_TOTP_SECRET (base32) turns on 6-digit authenticator codes (RFC 6238: HMAC-SHA1, 30 s steps). */
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

/* ---------- TOTP (Google Authenticator, Microsoft Authenticator, Authy, 1Password ...) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!clean) return null;
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) return null;
    val = ((val << 5) | i) & 0xfffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = ((val << 8) | b) & 0xfffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
const generateTotpSecret = () => base32Encode(crypto.randomBytes(20)); // 160 bits
const isValidTotpSecret = s => { const b = base32Decode(s); return !!b && b.length >= 10; };
function hotp(key, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
const totpStep = nowMs => Math.floor(nowMs / 30000);
const totpCode = (secret, nowMs) => hotp(base32Decode(secret), totpStep(nowMs));
/* -> the 30-second step the code belongs to (so the caller can refuse a second use), or null. Accepts 1 step either side for clock drift. */
function verifyTotp(secret, code, nowMs) {
  const c = String(code == null ? '' : code).replace(/\s/g, '');
  const key = base32Decode(secret);
  if (!key || !/^\d{6}$/.test(c)) return null;
  const cur = totpStep(nowMs); let hit = null;
  for (let d = -1; d <= 1; d++) {
    const want = Buffer.from(hotp(key, cur + d));
    if (crypto.timingSafeEqual(want, Buffer.from(c)) && hit === null) hit = cur + d; // no early exit: same work every time
  }
  return hit;
}
const totpUri = (secret, label, issuer) => 'otpauth://totp/' + encodeURIComponent(issuer + ':' + label) + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30';

/* Admin login is only offered when it is configured safely. */
function adminConfigProblem(env) {
  if (env.ADMIN_TOTP_SECRET && !isValidTotpSecret(env.ADMIN_TOTP_SECRET)) return 'ADMIN_TOTP_SECRET is not a valid key. Make a new one with: node scripts/make-2fa.js';
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

module.exports = { generateTotpSecret, isValidTotpSecret, verifyTotp, totpCode, totpUri, base32Decode, base32Encode, verifyPassword, hashPassword, adminConfigProblem, signSession, verifySession, parseCookies, hashIp };
