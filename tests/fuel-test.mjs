import assert from 'node:assert';
import { buildPath } from '../js/guidance.js';
import { samplePath, buildQuery, parseStations, placeStations, sideAt, spokenName, fetchStations, FuelWatch } from '../js/fuel.js';
let n = 0; const ok = (m) => console.log('PASS', m, ++n);

// a straight route going north from (-6.9, 107.6), 20 km
const coords = Array.from({ length: 201 }, (_, i) => [-6.9 + i * 0.0009, 107.6]);
const path = buildPath(coords);
assert.ok(path.total > 19000 && path.total < 21000); ok('test route is about 20 km');

const pts = samplePath(path, 0, 10000, 1000);
assert.ok(pts.length >= 10 && pts.length <= 12, `got ${pts.length}`); assert.deepStrictEqual(pts[0], coords[0]);
assert.ok(samplePath(path, 0, 100000, 1000, 40).length <= 40); ok('samplePath thins the route and respects the point cap');

const q = buildQuery(pts.slice(0, 2), 400);
assert.ok(q.includes('["amenity"="fuel"]') && q.includes('around:400,-6.90000,107.60000,')); ok('Overpass query is built');

const json = { elements: [
  { type: 'node', id: 1, lat: -6.85, lon: 107.6006, tags: { name: 'SPBU 34-401', brand: 'Pertamina' } },   // east of a north-going road = right
  { type: 'way', id: 2, center: { lat: -6.80, lon: 107.5994 }, tags: { brand: 'Shell' } },                  // west = left
  { type: 'node', id: 3, lat: -6.85, lon: 107.60062, tags: { name: 'duplicate of 1' } },                    // within 60 m of 1
  { type: 'node', id: 4, lat: -6.70, lon: 107.7, tags: {} },                                                  // far from the route
  { type: 'node', id: 5, lat: 'x', lon: 1 }
] };
const parsed = parseStations(json); assert.strictEqual(parsed.length, 4); assert.strictEqual(parsed[1].name, 'Shell'); ok('parseStations reads nodes, ways (centre) and skips broken rows');
const placed = placeStations(path, parsed);
assert.deepStrictEqual(placed.map((s) => s.id), ['node1', 'way2'], JSON.stringify(placed.map((s) => s.id)));
assert.strictEqual(placed[0].side, 'right'); assert.strictEqual(placed[1].side, 'left');
assert.ok(Math.abs(placed[0].along - 5500) < 200, `along ${placed[0].along}`); assert.strictEqual(placed[0].brand, 'Pertamina'); ok('stations are placed on the route with the right side, duplicates and far ones dropped');
assert.strictEqual(sideAt(path, 3000, -6.87, 107.6003), 'right'); ok('sideAt');
assert.strictEqual(spokenName({ name: 'SPBU 34-401', brand: 'Pertamina' }), 'SPBU Pertamina');
assert.strictEqual(spokenName({ name: 'SPBU 34-40101', brand: '' }), 'SPBU');
assert.strictEqual(spokenName({ name: 'Shell Setiabudi', brand: '' }), 'SPBU Shell Setiabudi'); ok('spoken names');

// FuelWatch: window refetch + announcements
const calls = []; let changes = 0; const said = [];
const stationsAll = [
  { id: 'a', lat: -6.9 + 0.009, lng: 107.6004, name: 'A', brand: 'Pertamina' },   // ~1 km
  { id: 'b', lat: -6.9 + 0.0135, lng: 107.6004, name: 'B', brand: 'Shell' },       // ~1.5 km: inside the announce gap of a
  { id: 'c', lat: -6.9 + 0.09, lng: 107.5996, name: 'C', brand: 'Vivo' }           // ~10 km
];
const fw = new FuelWatch({ windowM: 8000, refetchM: 2000, announceM: 2000, announceGapM: 6000, retryMs: 1000 }, {
  fetcher: async (points) => { calls.push(points.length); const lo = Math.min(...points.map((p) => p[0])) - 0.004, hi = Math.max(...points.map((p) => p[0])) + 0.004; return stationsAll.filter((s) => s.lat >= lo && s.lat <= hi); },
  onChange: () => { changes++; }, onAnnounce: (s, d) => said.push([s.id, Math.round(d)])
});
fw.setRoute({ coords });
fw.update(0, 1000); await new Promise((r) => setTimeout(r, 5));
assert.strictEqual(calls.length, 1); assert.deepStrictEqual(fw.list.map((s) => s.id), ['a', 'b']); ok('first window fetched and stations placed');
fw.update(5, 1050);
assert.strictEqual(said.length, 1); assert.strictEqual(said[0][0], 'a'); ok('first station announced inside 2 km');
fw.update(100, 1100); fw.update(600, 1200); assert.strictEqual(calls.length, 1, 'no refetch while the window is far from its end'); ok('no refetch while the window still has room');
fw.update(1200, 1300); assert.strictEqual(said.length, 1, 'b is inside the gap after a'); ok('stations closer than the announce gap are not read out one after another');
fw.update(6500, 2000); await new Promise((r) => setTimeout(r, 5));
assert.ok(calls.length >= 2 && fw.list.some((s) => s.id === 'c')); ok('the window moves on with the rider (refetch near its end)');
fw.update(8600, 2100); assert.deepStrictEqual(said.map((x) => x[0]), ['a', 'c']); ok('next station announced after the gap');
assert.strictEqual(fw.next(9500).id, 'c'); assert.strictEqual(fw.next(10200), null); ok('next() = nearest station ahead; passed ones are ignored');

// a refreshed route for the same trip keeps the stations already found (no flicker, no repeated announcement)
{ const seenChanges = []; const w = new FuelWatch({ windowM: 8000, refetchM: 2000, announceM: 2000, announceGapM: 6000, retryMs: 1000 }, { fetcher: async () => stationsAll.slice(0, 2), onChange: (l) => seenChanges.push(l.length), onAnnounce: (s2) => said2.push(s2.id) });
  const said2 = []; w.setRoute({ coords }); w.update(0, 1); await new Promise((r) => setTimeout(r, 5)); w.update(5, 2);
  w.setRoute({ coords: coords.slice(5) }, { keep: true }); assert.strictEqual(w.list.length, 2, 'kept'); w.update(0, 3); w.update(10, 4);
  assert.deepStrictEqual(said2, ['a'], 'not announced twice'); w.setRoute({ coords: coords.slice(5) }); assert.strictEqual(w.list.length, 0, 'a new trip starts empty'); }
ok('refreshing the route keeps stations and announcements; a new trip starts empty');

// failure: retry after the pause, not on every GPS fix
let failing = true; const fw2 = new FuelWatch({ windowM: 8000, refetchM: 2000, announceM: 2000, announceGapM: 6000, retryMs: 1000 }, { fetcher: async () => { calls.push('x'); if (failing) throw new Error('down'); return []; }, onChange() {}, onAnnounce() {} });
fw2.setRoute({ coords }); const before = calls.length; fw2.update(0, 5000); await new Promise((r) => setTimeout(r, 5));
fw2.update(10, 5100); await new Promise((r) => setTimeout(r, 5)); assert.strictEqual(calls.length, before + 1); assert.ok(fw2.failed);
failing = false; fw2.update(20, 6200); await new Promise((r) => setTimeout(r, 5)); assert.strictEqual(calls.length, before + 2); assert.ok(!fw2.failed); ok('a failed lookup waits before retrying, then recovers');

// disabled / new route
fw2.setEnabled(false); const c2 = calls.length; fw2.update(5000, 9000); assert.strictEqual(calls.length, c2); ok('disabled: no requests');
fw.setRoute(null); fw.update(100, 99999); assert.strictEqual(fw.list.length, 0); ok('no route: nothing');

// mirror fallback
const seen = []; const res = await fetchStations(pts, { fetchImpl: async (url) => { seen.push(url); if (seen.length === 1) throw new Error('boom'); return { ok: true, json: async () => json }; } });
assert.strictEqual(seen.length, 2); assert.strictEqual(res.length, 4); ok('falls back to the second Overpass server');
await assert.rejects(fetchStations(pts, { fetchImpl: async () => ({ ok: false, status: 429 }) })); ok('both servers failing rejects');
console.log(`\n${n} passed`);
