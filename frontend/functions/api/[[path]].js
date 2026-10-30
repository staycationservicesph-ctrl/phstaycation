/* Cloudflare Pages: forwards every /api/* request to the backend so the browser only ever talks to this site (same origin).
   Needs Pages environment variables:  BACKEND_URL (e.g. https://your-name.onrender.com)  and  PROXY_SECRET (same value as the backend). */
export async function onRequest({ request, env }) {
  const backend = String(env.BACKEND_URL || '').replace(/\/+$/, '');
  const secret = env.PROXY_SECRET || '';
  if (!backend || !secret) return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const url = new URL(request.url);
  const h = new Headers(request.headers);
  const ip = request.headers.get('cf-connecting-ip') || '';
  for (const k of ['host', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'x-client-ip', 'x-proxy-secret', 'accept-encoding']) h.delete(k);
  h.set('accept-encoding', 'identity');
  h.set('x-client-ip', ip);
  h.set('x-proxy-secret', secret);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let up;
  try {
    up = await fetch(backend + url.pathname + url.search, { method: request.method, headers: h, body: hasBody ? await request.arrayBuffer() : undefined, redirect: 'manual', signal: AbortSignal.timeout(25000) });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upstream_unreachable' }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  const out = new Headers(up.headers);
  out.delete('content-encoding'); out.delete('content-length');
  return new Response(up.body, { status: up.status, headers: out });
}
