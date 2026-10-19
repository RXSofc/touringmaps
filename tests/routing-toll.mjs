// Toll hardening + reroute state machine, with a mocked network.
import assert from 'node:assert';
const log = []; let script = [];
globalThis.window = globalThis; globalThis.document = { }; 
globalThis.fetch = async (url) => {
  const u = new URL(url); const ex = u.searchParams.get('exclude'); log.push(ex || '-');
  const step = script.shift(); if (!step) throw new Error('unscripted request ' + url);
  if (step.net) throw new TypeError('network down');
  return { ok: step.status ? step.status < 400 : true, status: step.status || 200, headers: { get: () => 'application/json' }, json: async () => step.body, text: async () => JSON.stringify(step.body) };
};
const { fetchRoute, RouteManager } = await import('../js/routing.js');
const route = (classes = [], name = 'Jalan Raya') => ({ code: 'Ok', routes: [{ distance: 1000, duration: 100, geometry: { coordinates: [[107, -6], [107.01, -6.01]] }, legs: [{ steps: [{ maneuver: { type: 'depart', location: [107, -6] }, name, distance: 1000, intersections: [{ classes }] }] }] }] });
const A = { latitude: -6, longitude: 107 }, B = { latitude: -6.01, longitude: 107.01 };
let n = 0; const ok = (m) => console.log('PASS', m, ++n);

script = [{ body: route() }]; log.length = 0;
let r = await fetchRoute(A, B); assert.equal(log[0], 'toll'); assert.deepEqual(r.blockedClasses, []); ok('clean route asks exclude=toll');

script = [{ body: route(['toll']) }, { body: route(['motorway']) }, { body: route(['toll']) }]; log.length = 0;
r = await fetchRoute(A, B); assert.deepEqual(log, ['toll', 'motorway', '-']); assert.ok(r.blockedClasses.length); ok('every attempt tolled -> returned flagged, tried all options');

script = [{ body: route(['toll']) }, { body: route([]) }]; log.length = 0;
r = await fetchRoute(A, B); assert.deepEqual(r.blockedClasses, []); assert.deepEqual(log, ['toll', 'motorway']); ok('second option clean -> used');

script = [{ body: route([], 'Jalan Tol Cipularang') }, { body: route([]) }]; log.length = 0;
r = await fetchRoute(A, B); assert.deepEqual(r.blockedClasses, []); assert.equal(log.length, 2); ok('road named "Tol" counts as toll even if untagged');

script = [{ body: { code: 'NoSegment' } }]; log.length = 0;
await assert.rejects(fetchRoute(A, B), (e) => e.code === 'no-route'); ok('NoSegment is a plain error');
script = [{ body: route() }]; log.length = 0; await fetchRoute(A, B); assert.equal(log[0], 'toll'); ok('...and does NOT switch the toll filter off for later requests');

script = [{ status: 400, body: { code: 'InvalidValue', message: 'exclude' } }, { body: route(['motorway']) }, { body: route() }]; log.length = 0;
r = await fetchRoute(A, B); assert.deepEqual(log, ['toll', 'motorway', '-']); assert.deepEqual(r.blockedClasses, []); ok('server without exclude=toll: next option, result still scanned');
script = [{ body: route() }]; log.length = 0; await fetchRoute(A, B); assert.equal(log[0], 'motorway'); ok('unsupported exclude remembered');

const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting'); await new Promise((r) => setTimeout(r, 25)); } };
// ---- reroute state machine
const states = []; const m = new RouteManager({ onChange: (s) => states.push({ st: s.status, rr: s.rerouting }) });
script = [{ body: route() }, { body: route() }]; log.length = 0;
m.setDestination(B); m.updateOrigin(A); await waitFor(() => m.state.status === 'ok');
assert.equal(m.state.status, 'ok');
// first reroute attempt fails (net), second works
script = [{ net: true }, { body: route() }]; 
m.lastRequestAt = 0; m.reroute(10, 3);
assert.equal(m.state.rerouting, true); ok('reroute() marks rerouting');
await waitFor(() => !m.state.rerouting);
assert.equal(m.state.status, 'ok'); ok('failed request is retried, then rerouting clears');
// permanent failure stops retrying
script = [{ net: true }, { net: true }, { net: true }, { net: true }]; m.lastRequestAt = 0; m.reroute(5, 2);
await waitFor(() => !m.state.rerouting);
assert.equal(script.length, 1);
assert.equal(m.state.rerouting, false); assert.equal(m.state.status, 'error'); ok('gives up after the retry budget');
m.destroy(); console.log(`\n${n} passed`);
