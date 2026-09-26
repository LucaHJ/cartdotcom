const PATHS = new Set(['/investment.json', '/market.json', '/research.json']);
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': 'https://cartdotcom.com',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
};
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('{"error":"Read only"}', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    }
    if (!PATHS.has(url.pathname) || url.search) return new Response('{"error":"Not found"}', { status: 404, headers });
    const key = new Request(`${url.origin}${url.pathname}`);
    let response = await caches.default.match(key);
    if (!response) {
      try {
        // Never forward visitor headers, credentials, query strings or arbitrary paths.
        const upstream = await env.ORIGIN.fetch(`http://origin/portfolio-public${url.pathname}`, {
          method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000)
        });
        if (!upstream.ok || !upstream.headers.get('content-type')?.includes('application/json')) throw new Error('Unavailable');
        const size = Number(upstream.headers.get('content-length'));
        if (!Number.isFinite(size) || size < 1 || size > 2_000_000) throw new Error('Invalid size');
        response = new Response(upstream.body, { headers: { ...headers, 'Cache-Control': 'public, max-age=30' } });
        ctx.waitUntil(caches.default.put(key, response.clone()));
      } catch {
        return new Response('{"error":"Production snapshot temporarily unavailable"}', { status: 503, headers });
      }
    }
    return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
  }
};
