// worker.js — Cloudflare Worker Proxy for xiangsuai.cn
// Deploy: Cloudflare Dashboard → Workers & Pages → Create Worker → Paste this → Save & Deploy
// Result: https://your-worker.your-subdomain.workers.dev/api/v1/images/edits

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only proxy /api/v1/images/edits (and OPTIONS for CORS preflight)
    if (!url.pathname.startsWith('/api/v1/images/edits')) {
      return new Response('Not Found', { status: 404 });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Build target URL: replace /api with empty string
    const targetPath = url.pathname.replace('/api', '') + url.search;
    const targetUrl = `https://www.xiangsuai.cn${targetPath}`;

    // Clone headers, set Host, forward Authorization
    const headers = new Headers(request.headers);
    headers.set('Host', 'www.xiangsuai.cn');
    // Ensure we don't forward problematic headers
    headers.delete('origin');
    headers.delete('referer');

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'follow',
        // CF specific: skip cache for API calls
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      // Return response with CORS headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      responseHeaders.set('Access-Control-Expose-Headers', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      console.error('[Worker Proxy Error]', err);
      return new Response(JSON.stringify({ error: 'Bad Gateway', message: err.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

function handleOptions(request) {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}