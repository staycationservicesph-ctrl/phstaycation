/* The API server (Render runs this). Serves /api/* and, for local development, the ../frontend folder,
   with the security headers from headers.json. Run:  node server.js   (needs Node 22+) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./lib/app');

const PUBLIC = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'frontend')); // local dev only: serves the frontend folder next to this one
const HEADERS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'headers.json'), 'utf8')); } catch (e) { return []; } })();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  for (const h of HEADERS) res.setHeader(h.key, h.value);
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (p.startsWith('/api/')) return handle(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (p === '/') p = '/index.html';
  if (p === '/admin') { p = '/admin.html'; res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-store'); }
  /* Only website files are public: no dotfiles, no _headers, no functions/ (Cloudflare-only code), no .env.example. */
  if (p.split('/').some(seg => seg.startsWith('.')) || p === '/_headers' || p.startsWith('/functions/') || !MIME[path.extname(p)]) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); } // no path traversal
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const cc = p.startsWith('/img/') ? 'public, max-age=31536000, immutable' : (res.getHeader('Cache-Control') || 'no-cache');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cc });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log('Manila Prime running on http://localhost:' + port));
}
module.exports = { server };
