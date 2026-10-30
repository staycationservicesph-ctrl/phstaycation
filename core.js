/* Shared by the browser (public/app.js) and the server (lib/*). Pure functions only: no DOM, no I/O.
   All dates are ISO strings YYYY-MM-DD and all date maths is done in UTC, so results are identical everywhere. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = n => String(n).padStart(2, '0');
  const parse = s => { const a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); };
  const iso = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const nightsBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const isValidDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
  const isWknd = s => { const g = parse(s).getUTCDay(); return g === 5 || g === 6; }; // Fri + Sat nights
  const manilaToday = nowMs => new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  /* unit: {id, price (Sun-Thu), weekend (Fri/Sat), base, max, extra}
     rules: [{unit:'all'|id, from, to, price}]  (later rules win) */
  function nightPrice(un, day, rules) {
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if ((r.unit === 'all' || r.unit === un.id) && day >= r.from && day <= r.to) return { p: r.price, k: 'special' };
    }
    return isWknd(day) ? { p: un.weekend, k: 'weekend' } : { p: un.price, k: 'weekday' };
  }
  function quote(unit, ci, co, guests, rules) {
    const n = nightsBetween(ci, co), extraGuests = Math.max(0, guests - unit.base);
    const g = { weekday: { n: 0, sum: 0, p: unit.price }, weekend: { n: 0, sum: 0, p: unit.weekend }, special: { n: 0, sum: 0, p: 0 } };
    let room = 0;
    for (let i = 0; i < n; i++) {
      const np = nightPrice(unit, addDays(ci, i), rules);
      room += np.p; g[np.k].n++; g[np.k].sum += np.p;
    }
    const extra = extraGuests * unit.extra * n;
    return { n, room, extra, extraGuests, total: room + extra, groups: g };
  }

  const cleanText = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const LIMITS = { name: 80, phone: 25, email: 120, message: 1000, maxNights: 60, maxAheadDays: 730, maxGroup: 100 };
  const PHONE_OK = p => /^[0-9+()\- ]+$/.test(p) && p.replace(/\D/g, '').length >= 7 && p.replace(/\D/g, '').length <= 15 && p.length <= LIMITS.phone;
  const EMAIL_OK = e => e.length <= LIMITS.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
  const str = v => (typeof v === 'string' ? v.trim() : '');

  /* Validates a booking request. Returns {ok, fields:{field:message}, value}.
     The server never trusts price or availability sent by the client. */
  function validateBooking(input, unit, today) {
    const f = {}; input = input || {};
    const ci = input.ci, co = input.co, name = str(input.name), phone = str(input.phone), email = str(input.email);
    if (!unit) f.unit = 'Choose a unit.';
    if (!isValidDate(ci) || !isValidDate(co)) f.dates = 'Choose valid check-in and check-out dates.';
    else if (ci < today) f.dates = 'Check-in cannot be in the past.';
    else if (co <= ci) f.dates = 'Check-out must be after check-in.';
    else if (nightsBetween(ci, co) > LIMITS.maxNights) f.dates = 'For stays longer than ' + LIMITS.maxNights + ' nights, please send an inquiry.';
    else if (ci > addDays(today, LIMITS.maxAheadDays)) f.dates = 'That date is too far ahead.';
    const guests = input.guests;
    if (!Number.isInteger(guests) || guests < 1 || (unit && guests > unit.max)) f.guests = 'Choose the number of guests' + (unit ? ' (1 to ' + unit.max + ').' : '.');
    if (name.length < 2 || name.length > LIMITS.name) f.name = 'Enter your full name.';
    if (!PHONE_OK(phone)) f.phone = 'Enter a mobile number we can reach you on.';
    if (!EMAIL_OK(email)) f.email = 'Enter a valid email address.';
    if (input.rules !== true) f.rules = 'Accept the house rules to continue.';
    return { ok: Object.keys(f).length === 0, fields: f, value: { ci, co, guests, name: cleanText(name, LIMITS.name), phone: cleanText(phone, LIMITS.phone), email: cleanText(email, LIMITS.email) } };
  }
  function validateInquiry(input, today) {
    const f = {}; input = input || {};
    const name = str(input.name), phone = str(input.phone), email = str(input.email);
    const message = typeof input.message === 'string' ? input.message : '';
    if (name.length < 2 || name.length > LIMITS.name) f.name = 'Enter your full name.';
    if (!PHONE_OK(phone)) f.phone = 'Enter a mobile number we can reach you on.';
    if (!EMAIL_OK(email)) f.email = 'Enter a valid email address.';
    if (!isValidDate(input.ci) || !isValidDate(input.co) || input.ci < today || input.co <= input.ci) f.dates = 'Choose a check-in date and a later check-out date.';
    if (!Number.isInteger(input.guests) || input.guests < 5 || input.guests > LIMITS.maxGroup) f.guests = 'Enter the number of guests (5 to ' + LIMITS.maxGroup + ').';
    if (message.length > LIMITS.message) f.message = 'Message is too long.';
    return { ok: Object.keys(f).length === 0, fields: f, value: { ci: input.ci, co: input.co, guests: input.guests, name: cleanText(name, LIMITS.name), phone: cleanText(phone, LIMITS.phone), email: cleanText(email, LIMITS.email), message: cleanText(message, LIMITS.message) } };
  }

  return { pad, parse, iso, addDays, nightsBetween, isValidDate, isWknd, manilaToday, nightPrice, quote, cleanText, LIMITS, validateBooking, validateInquiry };
});
