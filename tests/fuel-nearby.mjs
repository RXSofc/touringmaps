// "SPBU terdekat": the nearest fuel stations around the rider, in any direction, no route needed.
// Query, ranking, direction words (relative to the heading when moving, compass when still), the widening radius,
// the mirror fallback, the 60 s cache and the spoken line. Mocked network.
import assert from 'node:assert';
const F = await import('../js/fuel.js');
const { bearingDeg } = await import('../js/geo.js');
const { lines: voiceLines } = await import('../js/voicelines.js');
let n = 0; const ok = (m) => console.log('PASS', m, ++n);
const ME = { latitude: -6.9, longitude: 107.6 };

/* ---------------------------------------------------------------- query */
const q = F.buildNearbyQuery(-6.9, 107.6, 3000);
assert.ok(q.includes('["amenity"="fuel"]') && q.includes('around:3000,-6.90000,107.60000') && q.includes('out center')); ok('the query asks for fuel stations within the radius of one point');

/* -------------------------------------------------------------- bearing */
const north = bearingDeg(ME, { latitude: -6.8, longitude: 107.6 }), east = bearingDeg(ME, { latitude: -6.9, longitude: 107.7 });
const south = bearingDeg(ME, { latitude: -7.0, longitude: 107.6 }), west = bearingDeg(ME, { latitude: -6.9, longitude: 107.5 });
assert.ok(Math.abs(north - 0) < 0.5 || Math.abs(north - 360) < 0.5); assert.ok(Math.abs(east - 90) < 0.6); assert.ok(Math.abs(south - 180) < 0.5); assert.ok(Math.abs(west - 270) < 0.6); ok('bearing: north 0, east 90, south 180, west 270');

/* ----------------------------------------------------- direction words */
const compass = [[0, 'utara'], [45, 'timur laut'], [90, 'timur'], [135, 'tenggara'], [180, 'selatan'], [225, 'barat daya'], [270, 'barat'], [315, 'barat laut'], [359, 'utara'], [-20, 'utara'], [22, 'utara'], [23, 'timur laut']];
for (const [deg, word] of compass) assert.equal(F.compassName(deg), word, `${deg} -> ${word}`); ok('compass names for the 8 directions, wrapping and rounding');
const rel = [[0, 'di depan'], [45, 'di depan kanan'], [90, 'di sebelah kanan'], [135, 'di belakang kanan'], [180, 'di belakang'], [225, 'di belakang kiri'], [270, 'di sebelah kiri'], [315, 'di depan kiri']];
for (const [b, word] of rel) assert.equal(F.relativeDirection(b, 0), word, `heading north, bearing ${b} -> ${word}`); ok('relative to a north-going rider: front, front-right, right...');
assert.equal(F.relativeDirection(0, 90), 'di sebelah kiri'); assert.equal(F.relativeDirection(350, 10), 'di depan'); assert.equal(F.relativeDirection(10, 350), 'di depan'); assert.equal(F.relativeDirection(180, 90), 'di sebelah kanan'); ok('relative direction follows the heading and wraps around 0/360');
assert.equal(F.describeDirection(0, 90, 8), 'di sebelah kiri'); ok('moving: relative to the heading');
assert.equal(F.describeDirection(45, 90, 0.3), 'di arah timur laut'); assert.equal(F.describeDirection(45, NaN, 10), 'di arah timur laut'); assert.equal(F.describeDirection(45, null, 10), 'di arah timur laut'); ok('standing still, or without a heading: compass direction');

/* -------------------------------------------------------------- ranking */
const st = (id, dLat, dLng, extra = {}) => ({ id, lat: ME.latitude + dLat, lng: ME.longitude + dLng, name: extra.name || `SPBU ${id}`, brand: extra.brand || '' });
const list = [st('far', 0.04, 0), st('mid', 0, 0.02), st('near', 0.005, 0), st('bad', NaN, 0), st('near-dup', 0.00502, 0.00001, { name: 'Pertamina duplicate' }), st('s', -0.01, 0), st('e', 0, 0.03), st('w', 0, -0.025)];
const ranked = F.rankNearby(list, ME);
assert.deepEqual(ranked.map((s) => s.id), ['near', 's', 'mid', 'w', 'e']); ok('sorted by distance, at most 5, invalid stations dropped');
assert.ok(ranked.every((s) => Number.isFinite(s.distanceM) && Number.isFinite(s.bearing))); assert.ok(Math.abs(ranked[0].distanceM - 556) < 15); ok('every station carries its distance (m) and bearing');
assert.ok(!ranked.some((s) => s.id === 'near-dup')); ok('a station mapped twice (node + building) within 60 m is listed once, the nearer one');
assert.equal(F.rankNearby(list, ME, { limit: 2 }).length, 2); assert.deepEqual(F.rankNearby([], ME), []); ok('limit option and empty input');
const input = [st('b', 0.02, 0), st('a', 0.01, 0)]; F.rankNearby(input, ME); assert.deepEqual(input.map((s) => s.id), ['b', 'a']); ok('ranking does not mutate its input');

/* ---------------------------------------------------------- fetchNearby */
const el = (id, dLat, dLng) => ({ type: 'node', id, lat: ME.latitude + dLat, lon: ME.longitude + dLng, tags: { name: `SPBU ${id}` } });
const reply = (elements) => ({ ok: true, status: 200, json: async () => ({ elements }) });
const many = (k, step) => Array.from({ length: k }, (_, i) => el(i + 1, (i + 1) * step, 0));
function mockFetch(script) { const calls = []; const impl = async (url, init) => { calls.push({ url, body: decodeURIComponent(String(init.body)) }); const s = script.shift(); if (!s) throw new Error('unscripted'); if (s instanceof Error) throw s; return s; }; impl.calls = calls; return impl; }

let f = mockFetch([reply(many(6, 0.004))]);
let r = await F.fetchNearby(ME, { fetchImpl: f });
assert.equal(f.calls.length, 1); assert.equal(r.radiusM, 3000); assert.equal(r.stations.length, 5); assert.ok(f.calls[0].body.includes('around:3000')); ok('enough stations in the first radius: one request, top 5');
f = mockFetch([reply(many(2, 0.004)), reply(many(7, 0.01))]);
r = await F.fetchNearby(ME, { fetchImpl: f });
assert.equal(f.calls.length, 2); assert.equal(r.radiusM, 8000); assert.ok(f.calls[1].body.includes('around:8000')); assert.equal(r.stations.length, 5); ok('too few stations: the radius widens to 8 km');
f = mockFetch([reply([]), reply(many(1, 0.05)), reply(many(3, 0.1))]);
r = await F.fetchNearby(ME, { fetchImpl: f });
assert.equal(f.calls.length, 3); assert.equal(r.radiusM, 20000); assert.equal(r.stations.length, 3); ok('last radius is 20 km; whatever it finds is returned even if fewer than 5');
f = mockFetch([reply([]), reply([]), reply([])]);
r = await F.fetchNearby(ME, { fetchImpl: f }); assert.deepEqual(r.stations, []); assert.equal(r.radiusM, 20000); ok('nothing within 20 km: an empty list, not an error');
f = mockFetch([new Error('mirror 1 down'), reply(many(6, 0.004))]);
r = await F.fetchNearby(ME, { fetchImpl: f });
assert.equal(f.calls.length, 2); assert.notEqual(f.calls[0].url, f.calls[1].url); assert.equal(r.stations.length, 5); ok('first Overpass mirror down: the second one is used');
f = mockFetch([new Error('down'), new Error('down too')]);
await assert.rejects(F.fetchNearby(ME, { fetchImpl: f }), /down/); ok('every mirror down: the error is thrown (the UI shows a retry)');
f = mockFetch([{ ok: false, status: 429, json: async () => ({}) }, reply(many(6, 0.004))]);
r = await F.fetchNearby(ME, { fetchImpl: f }); assert.equal(r.stations.length, 5); ok('an HTTP error (rate limit) counts as a failed mirror');
const ctl = new AbortController(); ctl.abort();
await assert.rejects(F.fetchNearby(ME, { fetchImpl: async () => { throw new Error('aborted'); }, signal: ctl.signal }), /abort/i); ok('an aborted lookup throws instead of retrying');
await assert.rejects(F.fetchNearby({ latitude: NaN, longitude: 1 }, { fetchImpl: mockFetch([]) }), /position/i); ok('no usable position: a clear error, no network call');

/* ---------------------------------------------------------------- cache */
let t = 1_000_000; const cache = F.createNearbyCache({ ttlMs: 60000, moveM: 300, now: () => t });
assert.equal(cache.get(ME), null); cache.set(ME, { stations: [1] });
assert.deepEqual(cache.get(ME), { stations: [1] }); assert.deepEqual(cache.get({ latitude: -6.9 + 0.002, longitude: 107.6 }), { stations: [1] }); ok('cache: same place within 60 s and under 300 m is reused');
assert.equal(cache.get({ latitude: -6.9 + 0.004, longitude: 107.6 }), null); ok('cache: moved more than 300 m = a fresh lookup');
t += 61000; assert.equal(cache.get(ME), null); ok('cache: expires after 60 s');
cache.set(ME, { stations: [2] }); cache.clear(); assert.equal(cache.get(ME), null); ok('cache: clear');

/* ----------------------------------------------------------- spoken line */
const said = [voiceLines.fuelNearest('SPBU Pertamina Garut', 1230, 'di depan kiri'), voiceLines.fuelNearest('SPBU Shell', 450, 'di arah timur laut'), voiceLines.fuelNearest('SPBU Pertamina', 90, 'di sebelah kanan')];
for (const s of said) { assert.ok(!/undefined|NaN|null/.test(s), s); assert.ok(/SPBU/.test(s), s); }
assert.ok(said[0].includes('di depan kiri') && /kilometer/i.test(said[0])); assert.ok(said[1].includes('di arah timur laut') && /meter/i.test(said[1])); ok('the spoken line names the station, the distance in words and the direction');
assert.ok(voiceLines.fuelNearest('SPBU X', 100, '').length > 10 && !/\s{2,}/.test(voiceLines.fuelNearest('SPBU X', 100, ''))); ok('without a direction the sentence is still clean');

console.log(`\n${n} passed`);
