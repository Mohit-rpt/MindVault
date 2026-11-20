/**
 * MindVault — Cloudflare Pages API Reverse Proxy Function
 *
 * Edge route: /api/* -> https://mindvault-api-7xqh.onrender.com/api/*
 *
 * Features & Operational Guarantees:
 * 1. Single-Origin Architecture:
 *    Browser communicates with Cloudflare Pages domain (same-origin).
 *    HttpOnly refresh cookies (SameSite=Strict) are treated as first-party
 *    by modern browsers and preserved on page reload.
 * 2. Prefix & Query Preservation:
 *    Preserves the full path including '/api' and all query parameters.
 * 3. HTTP Methods & Payloads:
 *    Proxies GET, POST, PUT, PATCH, DELETE, OPTIONS, and HEAD.
 *    Streams request bodies (JSON, multipart/form-data for file uploads).
 * 4. Streaming & SSE Support:
 *    Passes through streaming responses (Server-Sent Events) without buffering.
 * 5. Anti-SSRF / Security:
 *    Upstream target is fixed to BACKEND_API_URL environment variable.
 *    Never accepts target origins from query parameters, path, or client headers.
 * 6. Zero Node.js Dependency:
 *    Built exclusively using WHATWG standard Web APIs (Request, Response, Headers, URL)
 *    compatible with Cloudflare V8 edge isolates.
 */

interface Env {
  BACKEND_API_URL?: string;
}

interface EventContext<Env, P extends string, Data> {
  request: Request;
  functionPath: string;
  waitUntil: (promise: Promise<any>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
}

type PagesFunction<
  Env = unknown,
  Params extends string = any,
  Data extends Record<string, unknown> = Record<string, unknown>,
> = (context: EventContext<Env, Params, Data>) => Response | Promise<Response>;

const DEFAULT_BACKEND_URL = 'https://mindvault-api-7xqh.onrender.com';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const clientUrl = new URL(request.url);

  // 1. Resolve upstream backend target origin (strictly from env or fallback constant)
  const configuredBackend = (env.BACKEND_API_URL || DEFAULT_BACKEND_URL).trim();
  const backendBase = configuredBackend.replace(/\/+$/, '').replace(/\/api$/, '');

  // 2. Construct upstream URL preserving the exact path (including /api) and query params
  let targetUrl: URL;
  try {
    targetUrl = new URL(`${backendBase}${clientUrl.pathname}${clientUrl.search}`);
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'BAD_GATEWAY_URL',
          message: 'Invalid backend gateway target configuration',
        },
        meta: { timestamp: new Date().toISOString() },
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // 3. Clone and normalize request headers
  const reqHeaders = new Headers(request.headers);

  // Set Host header to upstream backend origin so Render routing functions correctly
  reqHeaders.set('host', targetUrl.host);

  // Pass forwarding metadata
  reqHeaders.set('x-forwarded-host', clientUrl.host);
  reqHeaders.set('x-forwarded-proto', clientUrl.protocol.replace(':', ''));

  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    reqHeaders.set('x-forwarded-for', clientIp);
  }

  // 4. Determine body handling based on HTTP method
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const fetchOptions: RequestInit & { duplex?: 'half' } = {
    method,
    headers: reqHeaders,
    body: hasBody ? request.body : undefined,
    redirect: 'manual', // Preserve 3xx redirects without following them inside the edge proxy
  };

  // Duplex streaming flag for WHATWG fetch implementations
  if (hasBody && request.body) {
    fetchOptions.duplex = 'half';
  }

  try {
    // 5. Execute server-to-server HTTPS request to Render API
    const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

    // 6. Clone and normalize response headers
    const resHeaders = new Headers(upstreamResponse.headers);

    // Handle Set-Cookie: strip any upstream domain attribute to ensure cookie attaches to Pages origin
    if (typeof (upstreamResponse.headers as any).getSetCookie === 'function') {
      const setCookies = (upstreamResponse.headers as any).getSetCookie() as string[];
      if (setCookies && setCookies.length > 0) {
        resHeaders.delete('set-cookie');
        for (const cookieStr of setCookies) {
          // Strip Domain=... so browser binds cookie directly to current Pages origin
          const normalizedCookie = cookieStr.replace(/;\s*Domain=[^;]+/gi, '');
          resHeaders.append('set-cookie', normalizedCookie);
        }
      }
    } else {
      const rawSetCookie = resHeaders.get('set-cookie');
      if (rawSetCookie) {
        const normalizedCookie = rawSetCookie.replace(/;\s*Domain=[^;]+/gi, '');
        resHeaders.set('set-cookie', normalizedCookie);
      }
    }

    // 7. Ensure Server-Sent Events (SSE) responses disable proxy buffering
    const contentType = resHeaders.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      resHeaders.set('Cache-Control', 'no-cache, no-transform');
      resHeaders.set('X-Accel-Buffering', 'no');
    }

    // 8. Stream response body directly back to the client
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: resHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'GATEWAY_PROXY_ERROR',
          message: 'Failed to communicate with MindVault API gateway',
        },
        meta: { timestamp: new Date().toISOString() },
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
