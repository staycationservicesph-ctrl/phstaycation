/* Creates the app once per server instance (kept for the life of the server). */
const { createAdapter, ConfigError } = require('./db');
const { createStore } = require('./store');
const { createMailer } = require('./email');
const { createApp } = require('./router');

let app = null;
function getApp() {
  if (!app) {
    const adapter = createAdapter(process.env);
    app = createApp({ store: createStore(adapter, process.env), mailer: createMailer(process.env), env: process.env });
  }
  return app;
}
/* Same as app.handle but a missing database/config becomes a clean 503 instead of a crash. */
async function handle(req, res) {
  try { return await getApp().handle(req, res); }
  catch (e) {
    if (res.headersSent) return;
    console.error(e instanceof ConfigError ? 'config error: ' + e.message : 'fatal: ' + (e && e.message));
    res.writeHead(e instanceof ConfigError ? 503 : 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: e instanceof ConfigError ? 'not_configured' : 'server_error' }));
  }
}
module.exports = { handle, getApp };
