// Stops on the way ("titik lewat"), toll stretches for the map, the OpenRouteService adapter and the
// "never route back to a stop you already passed" rule. Mocked network, no real servers involved.
import assert from 'node:assert';
globalThis.window = globalThis; globalThis.document = {};
const calls = []; let script = [];
globalThis.fetch = async (url, init = {}) => {
  const step = script.shift();
  calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  if (!step) throw new Error('unscripted request ' + url);
  if (step.net) throw new TypeError('network down');
  return { ok: !step.status || step.status < 400, status: step.status || 200, headers: { get: () => 'application/json' }, json: async () => step.body, text: async () => JSON.stringify(step.body) };
};
const { MAP_CONFIG } = await import('../js/map-config.js');
const { fetchRoute, RouteManager, normalizeVia, externalNavLinks, parseOrsRoute, sortViaAlong } = await import('../js/routing.js');
const { TurnGuide } = await import('../js/guidance.js');
const { APP } = await import('../js/config.js');
let n = 0; const ok = (m) => console.log('PASS', m, ++n);
const A = { latitude: -6.0, longitude: 107.0 }, V1 = { latitude: -6.5, longitude: 107.5 }, V2 = { latitude: -7.0, longitude: 108.0 }, B = { latitude: -7.5, longitude: 108.5 };
const R = MAP_CONFIG.routing;
const useProviders = (...ids) => R.chain.splice(0, R.chain.length, ...ids);

/* ------------------------------------------------------------ normalizeVia */
assert.deepEqual(normalizeVia(undefined), []); assert.deepEqual(normalizeVia(null), []); assert.deepEqual(normalizeVia('x'), []);
assert.deepEqual(normalizeVia([V1, { latitude: 99, longitude: 0 }, V2]), [V1, V2]); ok('normalizeVia drops invalid points');
assert.deepEqual(normalizeVia({ 0: V1, 2: V2 }), [V1, V2]); ok('normalizeVia reads the object Firebase returns for a list with gaps');
assert.equal(normalizeVia([V1, V1, V1, V1, V1]).length, R.maxVia); ok('normalizeVia keeps at most maxVia stops');
assert.deepEqual(normalizeVia([{ latitude: -6.123456789, longitude: 107.987654321 }]), [{ latitude: -6.123457, longitude: 107.987654 }]); ok('normalizeVia rounds to 6 decimals');

/* -------------------------------------------------------------- OSRM + via */
const osrmStep = (type, loc, extra = {}) => ({ maneuver: { type, location: loc, modifier: extra.modifier }, name: extra.name || 'Jalan', distance: 500, intersections: [{ classes: extra.classes || [] }], geometry: { type: 'LineString', coordinates: extra.geo || [loc, [loc[0] + 0.01, loc[1] - 0.01]] } });
const osrmTwoLegs = (tollMiddle = false) => ({ code: 'Ok', routes: [{ distance: 90000, duration: 5000, geometry: { coordinates: [[107, -6], [107.5, -6.5], [108.5, -7.5]] }, legs: [
  { steps: [osrmStep('depart', [107, -6]), osrmStep('turn', [107.2, -6.2], { modifier: 'right', classes: tollMiddle ? ['toll', 'motorway'] : [], name: tollMiddle ? 'Jalan Tol Cipularang' : 'Jalan Raya', geo: [[107.2, -6.2], [107.3, -6.3], [107.4, -6.4]] }), osrmStep('arrive', [107.5, -6.5])] },
  { steps: [osrmStep('depart', [107.5, -6.5]), osrmStep('turn', [108, -7], { modifier: 'left' }), osrmStep('arrive', [108.5, -7.5])] }
] }] });

useProviders('osrm-demo'); R.avoid.splice(0, R.avoid.length, 'toll');
script = [{ body: osrmTwoLegs() }]; calls.length = 0;
let r = await fetchRoute(A, B, { via: [V1] });
const q = decodeURIComponent(new URL(calls[0].url).pathname.split('/').pop());
assert.equal(q, '107.000000,-6.000000;107.500000,-6.500000;108.500000,-7.500000'); ok('OSRM request is from;via;to');
assert.deepEqual(r.via, [V1]); ok('the result remembers the stops');
assert.equal(r.steps.filter((s) => s.type === 'arrive').length, 1); assert.equal(r.steps.filter((s) => s.type === 'via').length, 1); ok('the end of the first leg becomes "via", only the last one stays "arrive"');
const g = new TurnGuide(APP.guidance, {}); g.setRoute(r);
assert.equal(g.maneuvers.filter((m) => m.step.type === 'arrive').length, 1); assert.ok(!g.maneuvers.some((m) => m.step.type === 'via')); ok('turn guidance never announces a stop as the arrival');
script = [{ body: osrmTwoLegs() }]; calls.length = 0; await fetchRoute(A, B);
assert.equal(decodeURIComponent(new URL(calls[0].url).pathname.split('/').pop()).split(';').length, 2); ok('no via: a plain two-point request, as before');

script = [{ body: osrmTwoLegs(true) }, { body: osrmTwoLegs(true) }]; r = await fetchRoute(A, B, { via: [V1] });   // exclude=toll, then the unfiltered try
assert.ok(r.blockedClasses.includes('toll')); assert.equal(r.tollSpans.length, 1); assert.deepEqual(r.tollSpans[0][0], [-6.2, 107.2]); assert.equal(r.tollSpans[0].length, 3); ok('a tolled stretch comes back as map coordinates (tollSpans)');
script = [{ body: osrmTwoLegs() }]; r = await fetchRoute(A, B); assert.deepEqual(r.tollSpans, []); ok('a clean route has no toll spans');

/* ---------------------------------------------------------- RouteManager */
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting'); await new Promise((x) => setTimeout(x, 20)); } };
const urlStops = (i) => decodeURIComponent(new URL(calls[i].url).pathname.split('/').pop()).split(';').length - 2;
{
  const m = new RouteManager({ onChange: () => {} });
  script = [{ body: osrmTwoLegs() }]; calls.length = 0;
  m.setDestination({ ...B, via: [V1, V2] }); m.updateOrigin(A); await waitFor(() => m.state.status === 'ok');
  assert.equal(urlStops(0), 2); ok('RouteManager asks for the destination together with its stops');

  // same destination + same stops: nothing new
  const before = calls.length; m.setDestination({ ...B, via: [V1, V2], updatedAt: 5 }); await new Promise((x) => setTimeout(x, 50));
  assert.equal(calls.length, before); ok('an unchanged destination (same stops) does not trigger a new request');

  // riding past V1: it is no longer asked for
  m.updateOrigin(V1); assert.equal(m.viaDone, 0); assert.deepEqual(m.pendingVia(), [V2]); ok('arriving at a stop marks it as done');
  script = [{ body: osrmTwoLegs() }]; m.lastRequestAt = 0; m.refresh();
  await waitFor(() => calls.length === before + 1); assert.equal(urlStops(before), 1); ok('later routes only contain the stops still ahead (never back to a passed stop)');
  m.updateOrigin({ latitude: -6.9, longitude: 107.9 }); // moving on, still 14 km from V2: it stays pending
  assert.deepEqual(m.pendingVia(), [V2]); ok('a stop not yet reached stays pending');

  // the leader changes the stops: reset and ask again
  script = [{ body: osrmTwoLegs() }]; const n0 = calls.length;
  m.setDestination({ ...B, via: [V2] }); await waitFor(() => calls.length === n0 + 1);
  assert.equal(m.viaDone, -1); assert.equal(urlStops(n0), 1); ok('changing the stops resets progress and re-requests');
  script = [{ body: osrmTwoLegs() }]; const n1 = calls.length;
  m.setDestination({ ...B }); await waitFor(() => calls.length === n1 + 1);
  assert.equal(urlStops(n1), 0); ok('removing all stops goes back to a direct route');
  m.destroy();
}

/* ------------------------------------------------------ OpenRouteService */
const orsGeo = [[107, -6], [107.1, -6.1], [107.5, -6.5], [107.6, -6.6], [108.5, -7.5]];
const orsAnswer = ({ toll = false } = {}) => ({ features: [{ geometry: { type: 'LineString', coordinates: orsGeo }, properties: {
  summary: { distance: 123456, duration: 7200 },
  way_points: [0, 2, 4],
  segments: [
    { steps: [{ distance: 1000, duration: 60, type: 11, name: '-', way_points: [0, 1] }, { distance: 2000, duration: 100, type: 1, name: 'Jalan Asia Afrika', way_points: [1, 2] }, { distance: 0, duration: 0, type: 10, name: '-', way_points: [2, 2] }] },
    { steps: [{ distance: 500, duration: 30, type: 11, name: '-', way_points: [2, 3] }, { distance: 900, duration: 80, type: 4, name: 'Jalan Raya Cirebon', way_points: [3, 4] }, { distance: 0, duration: 0, type: 10, name: '-', way_points: [4, 4] }] }
  ],
  extras: { tollways: { values: toll ? [[0, 2, 0], [2, 3, 1], [3, 4, 0]] : [[0, 4, 0]] } }
} }] });

const orsProvider = R.providers.ors; orsProvider.apiKey = 'test-key';
useProviders('ors'); R.avoid.splice(0, R.avoid.length, 'toll', 'motorway');
script = [{ body: orsAnswer() }]; calls.length = 0;
r = await fetchRoute(A, B, { via: [V1] });
const c0 = calls[0];
assert.equal(c0.method, 'POST'); assert.equal(c0.url, orsProvider.baseUrl); assert.equal(c0.headers.Authorization, 'test-key'); assert.equal(c0.headers['Content-Type'], 'application/json'); ok('ORS: POST with the key in the Authorization header');
assert.deepEqual(c0.body.coordinates, [[107, -6], [107.5, -6.5], [108.5, -7.5]]); ok('ORS: coordinates are [lng,lat] with the stop in the middle');
assert.deepEqual(c0.body.options, { avoid_features: ['tollways', 'highways'] }); assert.ok(c0.body.extra_info.includes('tollways')); ok('ORS: the first attempt avoids tollways and highways and asks for the toll extra');
assert.deepEqual(r.blockedClasses, []); assert.equal(r.tollAvoidedByServer, true); assert.equal(r.provider, 'ors'); ok('ORS: clean route accepted');
assert.deepEqual(r.coords[0], [-6, 107]); assert.equal(r.distanceMeters, 123456); ok('ORS: geometry is converted to [lat,lng]');
assert.deepEqual(r.steps.map((s) => s.type), ['depart', 'turn', 'via', 'depart', 'turn', 'arrive']); ok('ORS: types map to OSRM maneuvers, the first leg ends in "via"');
assert.equal(r.steps[1].modifier, 'right'); assert.equal(r.steps[4].modifier, 'slight left'); assert.equal(r.steps[0].name, ''); ok('ORS: modifiers mapped, "-" means no name');
const g2 = new TurnGuide(APP.guidance, {}); g2.setRoute(r);
assert.ok(g2.maneuvers.length >= 2); assert.ok(!g2.maneuvers.some((m) => m.step.type === 'via')); ok('ORS: the guidance accepts the converted route and skips the stop');

// tolled answer: flagged, spans drawn, ladder walks down
script = [{ body: orsAnswer({ toll: true }) }, { body: orsAnswer({ toll: true }) }, { body: orsAnswer({ toll: true }) }]; calls.length = 0;
r = await fetchRoute(A, B);
assert.equal(calls.length, 3); assert.deepEqual(calls.map((c) => c.body.options?.avoid_features || null), [['tollways', 'highways'], ['tollways'], null]); ok('ORS: tolled answer -> tries tollways only, then nothing');
assert.ok(r.blockedClasses.includes('toll')); assert.equal(r.tollSpans.length, 1); assert.deepEqual(r.tollSpans[0], [[-6.5, 107.5], [-6.6, 107.6]]); ok('ORS: still tolled at the end -> flagged, the tolled stretch is returned for the map');

// no route that avoids toll
script = [{ status: 404, body: { error: { code: 2010, message: 'Could not find routable point' } } }, { status: 404, body: { error: { code: 2009, message: 'Route could not be found' } } }, { body: orsAnswer({ toll: true }) }]; calls.length = 0;
r = await fetchRoute(A, B); assert.ok(r.blockedClasses.includes('toll')); ok('ORS: "no route" while avoiding, but one exists with toll -> returned flagged, never silently used');
script = [{ status: 404, body: { error: { code: 2009 } } }, { status: 404, body: { error: { code: 2009 } } }, { status: 404, body: { error: { code: 2009 } } }];
await assert.rejects(fetchRoute(A, B), (e) => e.code === 'no-route-toll-free'); ok('ORS: nothing found anywhere -> "no toll-free route"');

// a server that rejects the avoid option (self-hosted without it): next rung, remembered
script = [{ status: 400, body: { error: { code: 2099, message: 'bad option' } } }, { status: 400, body: { error: { code: 2099 } } }, { body: orsAnswer() }]; calls.length = 0;
r = await fetchRoute(A, B); assert.equal(calls.length, 3); assert.deepEqual(r.blockedClasses, []); ok('ORS: avoid rejected -> falls to the next rung');
script = [{ body: orsAnswer() }]; calls.length = 0; await fetchRoute(A, B); assert.equal(calls.length, 1); assert.equal(calls[0].body.options, undefined); ok('ORS: unsupported avoid is remembered for the session');

// rate limit moves on to the next provider in the chain
R.providers['osrm-demo'].minIntervalMs = 0; orsProvider.minIntervalMs = 0;
useProviders('ors', 'osrm-demo');
script = [{ status: 429, body: {} }, { body: osrmTwoLegs() }]; calls.length = 0;
r = await fetchRoute(A, B); assert.equal(r.provider, 'osrm-demo'); assert.equal(r.isFallback, true); ok('rate-limited ORS -> the next provider answers (and is flagged as fallback)');

// parse errors
assert.throws(() => parseOrsRoute({}), (e) => e.code === 'invalid'); assert.throws(() => parseOrsRoute({ features: [{ geometry: { coordinates: [[1, 1]] }, properties: {} }] }), (e) => e.code === 'invalid'); ok('ORS: an unusable answer is an "invalid" error');

/* ------------------------------------------------------------ external links */
const links = externalNavLinks({ latitude: -7.5, longitude: 108.5, name: 'Tujuan', via: [V1, V2] });
assert.ok(links.google.includes('&waypoints=')); assert.equal(decodeURIComponent(links.google.split('&waypoints=')[1]), '-6.5,107.5|-7,108'); ok('"Open in Maps" carries the stops as waypoints');
assert.ok(!externalNavLinks({ latitude: 1, longitude: 2 }).google.includes('waypoints')); ok('no stops, no waypoints parameter');

/* ------------------------------------------------------------ order of stops */
{ const from = { latitude: -6.9, longitude: 107.6 }, to = { latitude: -7.8, longitude: 110.4 };
  const near = { latitude: -6.95, longitude: 108.2 }, mid = { latitude: -7.3, longitude: 109.2 }, far = { latitude: -7.7, longitude: 110.0 };
  assert.deepEqual(sortViaAlong([far, near, mid], from, to), [near, mid, far]); ok('stops are ordered along the way from the rider to the destination, whatever the tap order');
  assert.deepEqual(sortViaAlong([mid], from, to), [mid]); assert.deepEqual(sortViaAlong([], from, to), []); ok('ordering one or no stop is a no-op');
  const input = [far, near]; sortViaAlong(input, from, to); assert.deepEqual(input, [far, near]); ok('ordering does not mutate its input'); }

console.log(`\n${n} passed`);
