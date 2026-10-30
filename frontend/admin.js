(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = n => '\u20B1' + Number(n).toLocaleString('en-PH');
  const MPC = window.MPCore;
  const today = MPC.manilaToday(Date.now());
  const fmt = s => MPC.parse(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const when = ms => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const ERR = {
    dates_taken: 'Those dates are held by another booking.', invalid_state: 'That booking was already changed. The list has been refreshed.', not_found: 'Not found.',
    unauthorized: 'Your session ended. Please log in again.', rate_limited: 'Too many attempts. Please wait a few minutes.', wrong_password: 'Wrong password.',
    admin_not_configured: 'Admin login is not set up on the server yet (see the README).', validation: 'Please check the fields and try again.', bad_origin: 'Request blocked. Reload the page and try again.',
    not_configured: 'The server is not fully set up (database or settings missing).', server_error: 'Something went wrong on the server. Try again.'
  };
  let state = { bookings: [], units: [], rules: [], inquiries: [] };

  function say(text, bad) { const m = $('#msg'); m.textContent = text || ''; m.hidden = !text; m.className = 'note' + (bad ? ' bad' : ''); }
  function showLogin(text) { $('#dash').hidden = true; $('#login').hidden = false; $('#logout').hidden = true; say(text, !!text); }
  function showDash() { $('#login').hidden = true; $('#dash').hidden = false; $('#logout').hidden = false; }

  async function api(path, body) {
    const opts = { credentials: 'same-origin' };
    if (body !== undefined) { opts.method = 'POST'; opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(path, opts); } catch (e) { return { status: 0, body: { error: 'network' } }; }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 401 && path !== '/api/admin/login' && path !== '/api/admin/session') showLogin(ERR.unauthorized);
    return { status: r.status, ok: r.ok, body: j };
  }
  const errText = r => (r.body && r.body.fields && Object.values(r.body.fields)[0]) || ERR[r.body && r.body.error] || (r.status === 0 ? 'Could not reach the server. Check your connection.' : 'Something went wrong.');

  async function loadAll() {
    const [b, u, i] = await Promise.all([api('/api/admin/bookings?status=all'), api('/api/admin/units'), api('/api/admin/inquiries')]);
    if (!b.ok || !u.ok || !i.ok) { if (b.status !== 401 && u.status !== 401) say(errText(b.ok ? (u.ok ? i : u) : b), true); return false; }
    state = { bookings: b.body.bookings, units: u.body.units, rules: u.body.rules, inquiries: i.body.inquiries };
    render(); return true;
  }

  function badge(b) {
    const label = b.status === 'pending' && b.expired ? 'hold expired' : b.status;
    const cls = b.status === 'confirmed' ? 'ok' : (b.status === 'pending' && !b.expired) ? 'warn' : 'no';
    return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
  }
  function btn(act, id, text, quiet) { return '<button class="pill sm' + (quiet ? ' out' : '') + '" data-act="' + act + '" data-id="' + esc(id) + '">' + esc(text) + '</button>'; }

  function render() {
    const bk = state.bookings, f = $('#f-status').value;
    const pend = bk.filter(b => b.status === 'pending' && !b.expired);
    const up = bk.filter(b => b.status === 'confirmed' && b.co > today);
    $('#stats').innerHTML = '<div class="hst"><b>' + pend.length + '</b><span>Waiting for your reply</span></div><div class="hst"><b>' + up.length + '</b><span>Upcoming confirmed</span></div><div class="hst"><b>' + peso(up.reduce((a, b) => a + b.total, 0)) + '</b><span>Value of upcoming confirmed</span></div><div class="hst"><b>' + state.inquiries.length + '</b><span>Group inquiries</span></div>';
    const list = bk.filter(b => f === 'all' || b.status === f).sort((a, b) => (f === 'pending' ? a.createdAt - b.createdAt : a.ci < b.ci ? -1 : 1));
    $('#rows').innerHTML = list.length ? list.map(b => {
      const nights = MPC.nightsBetween(b.ci, b.co), blocked = b.status === 'blocked';
      const acts = [];
      if (b.status === 'pending') acts.push(btn('confirm', b.id, 'Confirm'), btn('decline', b.id, 'Decline', true));
      if (['pending', 'confirmed', 'blocked'].includes(b.status)) acts.push(btn('cancel', b.id, blocked ? 'Unblock' : 'Cancel', true));
      const guest = blocked ? esc(b.note || 'Blocked by host') : esc(b.name) + ' (' + b.guests + ')<br><a href="tel:' + esc(b.phone) + '">' + esc(b.phone) + '</a><br><a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>';
      const hold = b.status === 'pending' ? '<br><small>' + (b.expired ? 'Hold ended ' : 'Dates held until ') + esc(when(b.holdExpires)) + '</small>' : '';
      const mail = b.notifyOk === false ? '<br><small class="bad" title="' + esc(b.notifyError || '') + '">Email to you failed. Rely on this list.</small>' : '';
      return '<tr><td data-label="Reference"><div class="v">' + esc(b.code) + '<br><small>' + esc(when(b.createdAt)) + '</small></div></td><td data-label="Unit"><div class="v">' + esc(b.unit) + '</div></td><td data-label="Stay"><div class="v">' + esc(fmt(b.ci)) + ' to ' + esc(fmt(b.co)) + '<br><small>' + nights + (nights === 1 ? ' night' : ' nights') + '</small></div></td><td data-label="Guest"><div class="v">' + guest + '</div></td><td data-label="Total"><div class="v">' + (blocked ? '-' : peso(b.total)) + '</div></td><td data-label="Status"><div class="v">' + badge(b) + hold + mail + '</div></td><td class="acts" data-label=""><div class="v">' + acts.join(' ') + '</div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="muted">Nothing here.</td></tr>';

    const unitOpts = state.units.map(u => '<option value="' + esc(u.id) + '">Unit ' + esc(u.id) + ' - ' + esc(u.tower) + '</option>').join('');
    const keep = id => { const el = $(id), v = el.value; el.innerHTML = (id === '#r-unit' ? '<option value="all">All units</option>' : '') + unitOpts; if (v) el.value = v; };
    keep('#b-unit'); keep('#r-unit');
    $('#rates').innerHTML = state.units.map(u => '<tr data-unit="' + esc(u.id) + '"><td>Unit ' + esc(u.id) + '<br><small>' + esc(u.tower) + '</small></td><td><input type="number" min="1" step="50" value="' + u.price + '" data-f="weekday" aria-label="Sun to Thu rate, unit ' + esc(u.id) + '"></td><td><input type="number" min="1" step="50" value="' + u.weekend + '" data-f="weekend" aria-label="Fri and Sat rate, unit ' + esc(u.id) + '"></td><td><input type="number" min="0" step="50" value="' + u.extra + '" data-f="extra" aria-label="Extra guest fee, unit ' + esc(u.id) + '"></td><td>' + btn('save-rate', u.id, 'Save', true) + '</td></tr>').join('');
    $('#rules').innerHTML = state.rules.length ? state.rules.map(r => '<tr><td>' + esc(r.label || 'Special date') + '</td><td>' + (r.unit === 'all' ? 'All units' : 'Unit ' + esc(r.unit)) + '</td><td>' + esc(fmt(r.from)) + ' to ' + esc(fmt(r.to)) + '</td><td>' + peso(r.price) + '</td><td>' + btn('del-rule', r.id, 'Remove', true) + '</td></tr>').join('') : '<tr><td colspan="5" class="muted">No special dates yet.</td></tr>';
    $('#inq').innerHTML = state.inquiries.length ? state.inquiries.map(q => '<div class="inq"><b>' + esc(q.name) + '</b> - ' + q.guests + ' guests, ' + esc(fmt(q.ci)) + ' to ' + esc(fmt(q.co)) + '<br><a href="tel:' + esc(q.phone) + '">' + esc(q.phone) + '</a> | <a href="mailto:' + esc(q.email) + '">' + esc(q.email) + '</a>' + (q.message ? '<p>' + esc(q.message) + '</p>' : '') + '<small>' + esc(when(q.createdAt)) + '</small></div>').join('') : '<p class="muted">No group inquiries yet.</p>';
  }

  async function act(action, id) {
    if ((action === 'decline' || action === 'cancel') && !window.confirm(action === 'decline' ? 'Decline this request? The guest will be told if guest email is set up.' : 'Cancel this booking? The dates become free for other guests.')) return;
    const r = await api('/api/admin/booking-action', { id: Number(id), action });
    if (r.ok) say(action === 'confirm' ? 'Booking confirmed.' + (r.body.guestMail === 'sent' ? ' The guest was emailed.' : r.body.guestMail === 'failed' ? ' The guest email failed: please message the guest yourself.' : ' Please message the guest to tell them (guest email is not set up).') : 'Done.');
    else say(errText(r), true);
    await loadAll();
  }
  async function simple(path, body, ok) { const r = await api(path, body); if (r.ok) { say(ok); await loadAll(); return true; } say(errText(r), true); return false; }

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    t.disabled = true;
    try {
      if (a === 'confirm' || a === 'decline' || a === 'cancel') await act(a, id);
      else if (a === 'save-rate') {
        const row = t.closest('tr'), v = f => Number(row.querySelector('[data-f="' + f + '"]').value);
        await simple('/api/admin/rates', { unit: id, weekday: v('weekday'), weekend: v('weekend'), extra: v('extra') }, 'Rates saved for unit ' + id + '.');
      } else if (a === 'del-rule') await simple('/api/admin/rules-delete', { id: Number(id) }, 'Special rate removed.');
    } finally { t.disabled = false; }
  });
  $('#b-go').addEventListener('click', async () => { await simple('/api/admin/blocks', { unit: $('#b-unit').value, from: $('#b-from').value, to: $('#b-to').value, note: $('#b-note').value }, 'Dates blocked.'); });
  $('#r-go').addEventListener('click', async () => {
    if (await simple('/api/admin/rules', { unit: $('#r-unit').value, from: $('#r-from').value, to: $('#r-to').value, price: Number($('#r-price').value), label: $('#r-label').value }, 'Special rate added.')) { $('#r-label').value = ''; }
  });
  $('#f-status').addEventListener('change', render);
  $('#reload').addEventListener('click', async () => { say(''); await loadAll(); });
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', {}); showLogin('You are logged out.'); $('#msg').className = 'note'; });
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const b = $('#login-btn'); b.disabled = true; b.textContent = 'Checking...';
    const r = await api('/api/admin/login', { password: $('#pw').value });
    b.disabled = false; b.textContent = 'Log in';
    if (r.ok) { $('#pw').value = ''; say(''); showDash(); await loadAll(); } else say(errText(r), true);
  });

  (async function start() {
    const s = await api('/api/admin/session');
    if (s.ok && s.body && s.body.authenticated) { showDash(); await loadAll(); } else { showLogin(''); if (!s.ok) say(errText(s), true); }
  })();
})();
