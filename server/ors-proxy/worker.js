/**
 * Tiny Cloudflare Worker that sits between the app and OpenRouteService.
 *
 *  - the ORS API key lives here as a secret (ORS_API_KEY), never in the browser or the GitHub repo
 *  - only POST /directions from your own site (ALLOWED_ORIGINS) is accepted
 *  - the request body is rebuilt from a whitelist: 2..5 coordinates, the three avoid features, nothing else,
 *    so nobody can use your key for matrix / isochrone / export calls or oversized jobs
 *
 * Deploy: see docs/ROUTING.md (wrangler deploy, then `wrangler secret put ORS_API_KEY`).
 */
// api.openrouteservice.org is deprecated and shut down; the same keys work on api.heigit.org
const UPSTREAM = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
const AVOID = new Set(['tollways', 'highways', 'ferries']);
const MAX_BODY = 4096;

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Returns a clean ORS body, or a string describing what is wrong. */
export function sanitize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'body must be a JSON object';
  const c = input.coordinates;
  if (!Array.isArray(c) || c.length < 2 || c.length > 5) return 'coordinates: 2 to 5 points';
  const coordinates = [];
  for (const p of c) {
    if (!Array.isArray(p) || p.length < 2 || !num(p[0], -180, 180) || !num(p[1], -90, 90)) return 'coordinates: [lng, lat] numbers';
    coordinates.push([p[0], p[1]]);
  }
  const body = { coordinates, instructions: input.instructions !== false, instructions_format: 'text' };
  if (Array.isArray(input.extra_info)) body.extra_info = input.extra_info.filter((x) => x === 'tollways' || x === 'waytype');
  const avoid = input.options?.avoid_features;
  if (avoid !== undefined) {
    if (!Array.isArray(avoid) || avoid.length > 3 || !avoid.every((a) => AVOID.has(a))) return 'options.avoid_features: tollways, highways, ferries only';
    if (avoid.length) body.options = { avoid_features: [...new Set(avoid)] };
  }
  return body;
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes('*') || allowed.includes(origin);
  const h = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (ok && origin) h['Access-Control-Allow-Origin'] = origin;
  return { ok, headers: h };
}

const json = (status, obj, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
    if (url.pathname !== '/directions') return json(404, { error: 'not found' }, cors.headers);
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors.headers);
    if (!cors.ok) return json(403, { error: 'origin not allowed' });
    if (!env.ORS_API_KEY) return json(500, { error: 'ORS_API_KEY is not set on this worker' }, cors.headers);

    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'body too large' }, cors.headers);
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json(400, { error: 'invalid JSON' }, cors.headers); }
    const body = sanitize(parsed);
    if (typeof body === 'string') return json(400, { error: body }, cors.headers);

    let res;
    try {
      res = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { Authorization: env.ORS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      return json(502, { error: 'upstream unreachable' }, cors.headers);
    }
    // pass status and body through as they are: the app understands ORS error codes (2009/2010 = no route, 429 = rate limit)
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store', ...cors.headers } });
  }
};
