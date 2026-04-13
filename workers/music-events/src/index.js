/**
 * Music play/download ingest for Cloudflare Workers.
 *
 * Setup:
 * 1. Create a KV namespace (Workers & Pages → KV) and put its id in wrangler.toml as MUSIC_LOGS.
 * 2. Deploy: cd workers/music-events && npx wrangler deploy
 *    (wrangler.toml name must match the Worker in the dashboard, e.g. iterations.)
 * 3. Wrangler 4: `kv key list` uses local storage by default — add `--remote` to hit Cloudflare.
 * 4. Optional env vars (Dashboard → Worker → Settings → Variables):
 *    - ALLOWED_ORIGIN: https://iterations.band (comma-separate multiple origins if needed)
 *    - INGEST_SECRET: if set, POST /log must send header Authorization: Bearer <secret>
 *    - READ_SECRET: if set, GET /recent requires Authorization: Bearer <secret>
 *
 * Client (from iterations.band): POST JSON to https://<worker>.workers.dev/log
 * Body example: { "event": "play", "track": "Song Title", "trackId": "optional", "album": "optional" }
 * event must be "play" or "download" — other requests are not stored (no “access log” rows).
 */

/** Hosts that may POST /log or GET /recent from a browser (must match `Origin` exactly). */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://iterations.band',
  'https://www.iterations.band',
  'https://dfyhf.github.io',
];

function getAllowedOrigins(env) {
  const raw = env.ALLOWED_ORIGIN || env.ALLOWED_ORIGINS || '';
  if (!raw.trim()) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Only set `Access-Control-Allow-Origin` when the request `Origin` is allowlisted.
 * Sending a *different* allowed origin than the browser sent breaks CORS (e.g. www vs apex).
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = getAllowedOrigins(env);
  /** @type {Record<string, string>} */
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

/** @param {Date} date — use UTC fields (Workers clock is UTC). */
function formatTimestampAmPmMdYyyyUtc(date) {
  let h = date.getUTCHours();
  const min = date.getUTCMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  const hh = String(h).padStart(2, '0');
  const mStr = String(min).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${hh}:${mStr} ${ampm} ${mm}/${dd}/${yyyy}`;
}

function collectCfGeo(cf) {
  if (!cf || typeof cf !== 'object') return {};
  return {
    country: cf.country ?? null,
    region: cf.region ?? null,
    regionCode: cf.regionCode ?? null,
    city: cf.city ?? null,
    continent: cf.continent ?? null,
    timezone: cf.timezone ?? null,
    latitude: cf.latitude ?? null,
    longitude: cf.longitude ?? null,
    postalCode: cf.postalCode ?? null,
    metroCode: cf.metroCode ?? null,
    asn: cf.asn ?? null,
    asOrganization: cf.asOrganization ?? null,
    colo: cf.colo ?? null,
    isEUCountry: cf.isEUCountry ?? null,
  };
}

function collectTls(cf) {
  if (!cf || typeof cf !== 'object') return {};
  return {
    tlsVersion: cf.tlsVersion ?? null,
    tlsCipher: cf.tlsCipher ?? null,
    tlsClientAuth: cf.tlsClientAuth ?? null,
    httpProtocol: cf.httpProtocol ?? null,
  };
}

function collectClientFingerprint(request) {
  const h = request.headers;
  return {
    userAgent: h.get('User-Agent'),
    acceptLanguage: h.get('Accept-Language'),
    acceptEncoding: h.get('Accept-Encoding'),
    accept: h.get('Accept'),
    referer: h.get('Referer'),
    secChUa: h.get('Sec-CH-UA'),
    secChUaMobile: h.get('Sec-CH-UA-Mobile'),
    secChUaPlatform: h.get('Sec-CH-UA-Platform'),
    secChUaArch: h.get('Sec-CH-UA-Arch'),
    secChUaBitness: h.get('Sec-CH-UA-Bitness'),
    secChUaModel: h.get('Sec-CH-UA-Model'),
    secChUaFullVersionList: h.get('Sec-CH-UA-Full-Version-List'),
    secFetchSite: h.get('Sec-Fetch-Site'),
    secFetchMode: h.get('Sec-Fetch-Mode'),
    secFetchDest: h.get('Sec-Fetch-Dest'),
    dnt: h.get('DNT'),
    priority: h.get('Priority'),
    cfIpCountry: h.get('CF-IPCountry'),
    cfRay: h.get('CF-Ray'),
    cfVisitor: h.get('CF-Visitor'),
    trueClientIp: h.get('True-Client-IP'),
    xForwardedFor: h.get('X-Forwarded-For'),
  };
}

function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('True-Client-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    null
  );
}

async function handlePostLog(request, env, ctx, baseHeaders) {
  const secret = env.INGEST_SECRET;
  if (secret) {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${secret}`) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401, baseHeaders);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400, baseHeaders);
  }

  const event = body.event;
  if (event !== 'play' && event !== 'download') {
    return jsonResponse({ ok: false, error: 'invalid_event' }, 400, baseHeaders);
  }

  if (!env.MUSIC_LOGS) {
    return jsonResponse(
      { ok: false, error: 'kv_not_configured', hint: 'Bind KV namespace as MUSIC_LOGS' },
      500,
      baseHeaders
    );
  }

  const cf = request.cf || {};
  const id = crypto.randomUUID();
  const ts = String(Date.now()).padStart(15, '0');
  const key = `event:${ts}:${id}`;

  const record = {
    id,
    receivedAt: formatTimestampAmPmMdYyyyUtc(new Date()),
    event,
    track: body.track ?? null,
    trackId: body.trackId ?? null,
    album: body.album ?? null,
    url: body.url ?? null,
    clientTs: body.clientTs ?? null,
    extra: body.extra && typeof body.extra === 'object' ? body.extra : null,
    ip: clientIp(request),
    geo: collectCfGeo(cf),
    tls: collectTls(cf),
    edge: {
      requestPriority: cf.requestPriority ?? null,
      clientTcpRtt: cf.clientTcpRtt ?? null,
    },
    fingerprint: collectClientFingerprint(request),
  };

  try {
    await env.MUSIC_LOGS.put(key, JSON.stringify(record));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('MUSIC_LOGS.put failed', detail);
    return jsonResponse({ ok: false, error: 'kv_put_failed', detail }, 500, baseHeaders);
  }

  return jsonResponse({ ok: true, id }, 200, baseHeaders);
}

async function handleGetRecent(request, env, baseHeaders) {
  const secret = env.READ_SECRET;
  if (!secret) {
    return jsonResponse({ ok: false, error: 'read_disabled' }, 404, baseHeaders);
  }
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${secret}`) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, baseHeaders);
  }
  if (!env.MUSIC_LOGS) {
    return jsonResponse({ ok: false, error: 'kv_not_configured' }, 500, baseHeaders);
  }

  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));

  const listed = await env.MUSIC_LOGS.list({ prefix: 'event:', limit });
  const keys = listed.keys.sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, limit);

  const events = [];
  for (const k of keys) {
    const raw = await env.MUSIC_LOGS.get(k.name);
    if (raw) {
      try {
        events.push(JSON.parse(raw));
      } catch {
        events.push({ id: k.name, parseError: true });
      }
    }
  }

  return jsonResponse({ ok: true, events, cursor: listed.list_complete ? null : listed.cursor }, 200, baseHeaders);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const baseHeaders = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: baseHeaders });
    }

    // No storage for casual hits (GET /, probes, etc.)
    if (request.method === 'GET' && url.pathname === '/recent') {
      const res = await handleGetRecent(request, env, baseHeaders);
      const headers = new Headers(res.headers);
      Object.entries(baseHeaders).forEach(([k, v]) => headers.set(k, v));
      return new Response(res.body, { status: res.status, headers });
    }

    if (request.method === 'POST' && url.pathname === '/log') {
      const res = await handlePostLog(request, env, ctx, baseHeaders);
      const headers = new Headers(res.headers);
      Object.entries(baseHeaders).forEach(([k, v]) => headers.set(k, v));
      return new Response(res.body, { status: res.status, headers });
    }

    // Intentionally no KV write — not an instrumented play/download event
    return new Response(null, { status: 204, headers: baseHeaders });
  },
};
