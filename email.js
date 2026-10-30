/* Email notifications. A failed email NEVER fails a booking: the booking is already saved, and the
   dashboard shows which notifications failed. Every method returns {ok, error?} and never throws.
   EMAIL_PROVIDER = web3forms | resend | none
   - web3forms: uses WEB3FORMS_ACCESS_KEY. Only reaches the key owner (the host). Cannot email guests.
                NOTE: Web3Forms may restrict server-side calls to paid plans. NOT VERIFIED - see README.
   - resend:    uses RESEND_API_KEY + MAIL_FROM + NOTIFY_TO. Can email guests once a domain is verified in Resend. */
function createMailer(env, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const provider = (env.EMAIL_PROVIDER || 'none').toLowerCase();

  async function post(url, headers, body) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await f(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers), body: JSON.stringify(body), signal: ctl.signal });
      let j = null; try { j = await r.json(); } catch (e) {}
      return { ok: r.ok && (j == null || j.success !== false), error: r.ok ? (j && j.success === false ? String(j.message || 'rejected') : undefined) : 'HTTP ' + r.status };
    } catch (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network' }; }
    finally { clearTimeout(to); }
  }
  const plain = fields => Object.keys(fields).map(k => k + ': ' + fields[k]).join('\n');

  return {
    provider,
    /* Tell the host. fields: plain strings. */
    async notifyHost(subject, fields) {
      if (provider === 'none') return { ok: true, skipped: true };
      if (provider === 'web3forms') {
        if (!env.WEB3FORMS_ACCESS_KEY) return { ok: false, error: 'WEB3FORMS_ACCESS_KEY missing' };
        return post('https://api.web3forms.com/submit', {}, Object.assign({ access_key: env.WEB3FORMS_ACCESS_KEY, subject, from_name: 'Manila Prime Booking' }, fields));
      }
      if (provider === 'resend') {
        if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.NOTIFY_TO) return { ok: false, error: 'RESEND_API_KEY, MAIL_FROM or NOTIFY_TO missing' };
        return post('https://api.resend.com/emails', { Authorization: 'Bearer ' + env.RESEND_API_KEY }, { from: env.MAIL_FROM, to: [env.NOTIFY_TO], subject, text: plain(fields), reply_to: fields.email });
      }
      return { ok: false, error: 'unknown EMAIL_PROVIDER' };
    },
    /* Tell the guest. Only possible with Resend. */
    async notifyGuest(to, subject, text) {
      if (provider !== 'resend') return { ok: true, skipped: true };
      if (!env.RESEND_API_KEY || !env.MAIL_FROM) return { ok: false, error: 'RESEND_API_KEY or MAIL_FROM missing' };
      return post('https://api.resend.com/emails', { Authorization: 'Bearer ' + env.RESEND_API_KEY }, { from: env.MAIL_FROM, to: [to], subject, text, reply_to: env.NOTIFY_TO || undefined });
    }
  };
}
module.exports = { createMailer };
