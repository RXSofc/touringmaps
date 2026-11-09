// The ORS proxy worker: origin check, body whitelist, key handling, pass-through of upstream errors. Mocked upstream.
import assert from 'node:assert';
const worker = (await import('../server/ors-proxy/worker.js')).default;
const { sanitize } = await import('../server/ors-proxy/worker.js');
let n = 0; const ok = (m) => console.log('PASS', m, ++n);
const env = { ORS_API_KEY: 'secret-key', ALLOWED_ORIGINS: 'https://me.github.io, https://other.example' };
const good = { coordinates: [[107, -6], [108.5, -7.5]], instructions: true, extra_info: ['tollways'], options: { avoid_features: ['tollways', 'highways'] } };
let upstream = []; let reply = () => new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'Content-Type': 'application/geo+json' } });
globalThis.fetch = async (url, init) => { upstream.push({ url: String(url), init }); return reply(); };
const call = (path, { method = 'POST', origin = 'https://me.github.io', body, raw } = {}) =>
  worker.fetch(new Request('https://w.example' + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env);

let r = await call('/directions', { body: good });
assert.equal(r.status, 200); assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io'); ok('allowed origin gets through with CORS for exactly that origin');
assert.equal(upstream[0].init.headers.Authorization, 'secret-key'); assert.equal(upstream[0].url, 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson'); ok('the secret key is added server-side, the right ORS endpoint is called');
assert.deepEqual(JSON.parse(upstream[0].init.body).options, { avoid_features: ['tollways', 'highways'] }); ok('avoid_features are forwarded');

upstream = []; r = await call('/directions', { body: good, origin: 'https://evil.example' });
assert.equal(r.status, 403); assert.equal(upstream.length, 0); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null); ok('a foreign origin is refused before anything is forwarded');
r = await call('/directions', { method: 'OPTIONS' }); assert.equal(r.status, 204); assert.ok(r.headers.get('Access-Control-Allow-Methods').includes('POST')); ok('CORS preflight answered');
r = await call('/directions', { method: 'OPTIONS', origin: 'https://evil.example' }); assert.equal(r.status, 403); ok('preflight from a foreign origin refused');
assert.equal((await call('/directions', { method: 'GET' })).status, 405); assert.equal((await call('/matrix', { body: good })).status, 404); ok('only POST /directions exists');

// whitelist: nothing else gets through
upstream = [];
r = await call('/directions', { body: { ...good, profile: 'driving-hgv', radiuses: [1], options: { avoid_features: ['tollways'], avoid_polygons: { type: 'Polygon' }, profile_params: { x: 1 } }, language: 'zz', geometry_simplify: true } });
assert.equal(r.status, 200); const sent = JSON.parse(upstream[0].init.body);
assert.deepEqual(Object.keys(sent).sort(), ['coordinates', 'extra_info', 'instructions', 'instructions_format', 'options']); assert.deepEqual(sent.options, { avoid_features: ['tollways'] }); ok('unknown fields are dropped from the forwarded body');
for (const [label, body] of [['one point', { coordinates: [[1, 1]] }], ['six points', { coordinates: Array(6).fill([1, 1]) }], ['lat out of range', { coordinates: [[1, 95], [2, 2]] }], ['strings', { coordinates: [['1', '2'], [3, 4]] }], ['unknown avoid', { ...good, options: { avoid_features: ['fords'] } }], ['avoid not a list', { ...good, options: { avoid_features: 'tollways' } }]]) {
  upstream = []; r = await call('/directions', { body }); assert.equal(r.status, 400, label); assert.equal(upstream.length, 0, label);
}
ok('bad coordinates / avoid values are rejected with 400 and never forwarded');
r = await call('/directions', { raw: '{nope' }); assert.equal(r.status, 400); r = await call('/directions', { raw: JSON.stringify({ coordinates: [[1, 1], [2, 2]], pad: 'x'.repeat(5000) }) }); assert.equal(r.status, 413); ok('invalid JSON = 400, oversized body = 413');
assert.equal(typeof sanitize(null), 'string'); assert.equal(typeof sanitize([]), 'string'); ok('sanitize refuses non-objects');

// upstream behaviour is passed through
reply = () => new Response(JSON.stringify({ error: { code: 2010, message: 'no' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
r = await call('/directions', { body: good }); assert.equal(r.status, 404); assert.equal((await r.json()).error.code, 2010); ok('ORS error status and code are passed through (the app reads 2009/2010 and 429)');
reply = () => { throw new Error('down'); }; r = await call('/directions', { body: good }); assert.equal(r.status, 502); ok('upstream down = 502');
reply = () => new Response('{}'); const noKey = await worker.fetch(new Request('https://w.example/directions', { method: 'POST', headers: { Origin: 'https://me.github.io' }, body: JSON.stringify(good) }), { ALLOWED_ORIGINS: 'https://me.github.io' });
assert.equal(noKey.status, 500); ok('a worker without a key says so instead of calling ORS');
const open = await worker.fetch(new Request('https://w.example/directions', { method: 'POST', headers: { Origin: 'https://any.example' }, body: JSON.stringify(good) }), { ORS_API_KEY: 'k' });
assert.equal(open.status, 200); ok('with no ALLOWED_ORIGINS set the worker is open (documented: always set it)');
console.log(`\n${n} passed`);
