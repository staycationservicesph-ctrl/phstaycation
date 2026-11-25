/* In production (Render) the backend must serve the API only, never a second copy of the website. */
const test = require('node:test'); const assert = require('node:assert/strict'); const { spawn } = require('child_process'); const path = require('path');
async function run(env, port, fn) {
  const e = Object.assign({}, process.env, { PORT: String(port), SERVE_SITE: '', RENDER: '', NODE_ENV: '' }, env);
  const child = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: e, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:' + port + '/api/health'); break; } catch (x) { await new Promise(r => setTimeout(r, 100)); } }
    await fn('http://127.0.0.1:' + port);
  } finally { child.kill(); }
}
test('on Render: only the API; the website, admin page and images are not served here', async () => {
  await run({ RENDER: 'true' }, 3197, async base => {
    assert.ok([200, 503].includes((await fetch(base + '/api/health')).status)); // the API still answers (503 only because this test has no database)
    const root = await fetch(base + '/'); assert.equal(root.status, 200); assert.match(await root.text(), /API/); assert.equal(root.headers.get('x-robots-tag'), 'noindex, nofollow');
    for (const p of ['/index.html', '/admin', '/admin.html', '/app.js', '/img/logo.2f56a58d.webp', '/styles.css']) assert.equal((await fetch(base + p)).status, 404, p);
  });
});
test('NODE_ENV=production behaves the same; SERVE_SITE=1 turns the website back on', async () => {
  await run({ NODE_ENV: 'production' }, 3198, async base => assert.equal((await fetch(base + '/index.html')).status, 404));
  await run({ NODE_ENV: 'production', SERVE_SITE: '1' }, 3199, async base => assert.equal((await fetch(base + '/')).status, 200));
});
test('local development is unchanged: the website is served', async () => {
  await run({}, 3196, async base => { const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.match(await r.text(), /Stay in Manila/); });
});
