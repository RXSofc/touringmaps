// Simulated rides for the repeating wrong-way warning. The glue below mirrors updateWrongWay/wrongWayTick
// in js/views/touring.js (same rules, fake clock). Run: node tests/wrong-way-sim.mjs
import { TurnGuide } from '../js/guidance.js';
import { WrongWayWatch } from '../js/wrongway.js';
import { haversine } from '../js/geo.js';
const G = { offRouteM: 40, offRouteFixes: 2, offRouteFarM: 90, offRouteFarMaxAccM: 30, farSeconds: 30, farMinM: 200, farMaxM: 500, nearSeconds: 10, nearMinM: 60, nearMaxM: 200, nowM: 30, passedM: 25, arriveM: 25, warnRepeatMs: 4000, warnMovingMs: 8000, awayM: 150, awayTurnBackM: 60 };
const M = 111320; const LAT0 = -7.8; const LNG0 = 110.37; const cosL = Math.cos(LAT0 * Math.PI / 180);
const ll = (x, y) => [LAT0 + y / M, LNG0 + x / (M * cosL)];
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

function rig({ withRoute }) {
  let now = 1_000_000; const buzzes = []; const state = { wrongWay: null, destination: { latitude: ll(3000, 0)[0], longitude: ll(3000, 0)[1] }, route: null };
  let lastWarnAt = 0, lastMovedAt = 0, moveRef = null;
  const watch = new WrongWayWatch({ awayM: G.awayM, turnBackM: G.turnBackM ?? G.awayTurnBackM });
  const vibrate = (k) => buzzes.push({ k, t: now });
  const coords = []; for (let x = 0; x <= 3000; x += 10) coords.push(ll(x, 0));
  const steps = [{ type: 'depart', modifier: null, bearingAfter: 90, name: 'Jl. A', distance: 3000, location: ll(0, 0) }, { type: 'arrive', modifier: 'right', name: '', distance: 0, location: ll(3000, 0) }];
  const guide = new TurnGuide({ ...G, enabled: true, vibrate: true }, { onAlert() {}, onOffRoute() { lastWarnAt = now; vibrate('offroute'); } });
  if (withRoute) { guide.setRoute({ coords, steps }); state.route = { status: 'ok', route: { coords } }; }
  const usable = () => !!state.route?.route && state.route.status === 'ok';
  function updateWrongWay(fix) {
    if (!moveRef || haversine(moveRef, fix) >= 8) { if (moveRef) lastMovedAt = now; moveRef = { latitude: fix.latitude, longitude: fix.longitude }; }
    if (Number.isFinite(fix.speed) && fix.speed >= 1.5) lastMovedAt = now;
    let next = null;
    if (state.destination && !guide.arrived) {
      if (guide.offRoute) next = 'off'; else if (!usable() && watch.update(fix, state.destination)) next = 'away';
      if (usable()) watch.reset();
    } else watch.reset();
    if (next === state.wrongWay) return;
    state.wrongWay = next; if (next === 'away') { lastWarnAt = now; vibrate('wrong'); }
  }
  function tick() {
    if (!state.wrongWay) return; if (now - lastMovedAt > G.warnMovingMs) return;
    if (now - lastWarnAt >= G.warnRepeatMs) { lastWarnAt = now; vibrate('wrong'); }
  }
  // advance 1 s with a fix at (x, y); the 500 ms timer ticks twice
  const step = (x, y, speed) => { now += 500; tick(); now += 500; const [lat, lng] = ll(x, y); const fix = { latitude: lat, longitude: lng, accuracy: 6, speed }; guide.update(fix); updateWrongWay(fix); tick(); };
  return { step, buzzes, state, now: () => now };
}

// 1. on the route: silence
let r = rig({ withRoute: true });
for (let x = 0; x < 1500; x += 15) r.step(x, 0, 15);
ok(r.buzzes.length === 0 && !r.state.wrongWay, 'on route: no warning');

// 2. leaves the route (80 m north) and keeps riding: warning repeats every ~4 s
r = rig({ withRoute: true });
for (let x = 0; x < 600; x += 15) r.step(x, 0, 15);
const t0 = r.now();
for (let x = 600; x < 1000; x += 15) r.step(x, 80, 15);          // ~27 s off route
const moving = r.buzzes.filter((b) => b.t >= t0);
ok(r.state.wrongWay === 'off', 'off route flagged');
ok(moving.length >= 6, `repeats while riding wrong (got ${moving.length})`);
const gaps = moving.slice(1).map((b, i) => b.t - moving[i].t);
ok(gaps.every((g) => g >= 3500 && g <= 5500), `gaps about 4 s: ${gaps.join(',')}`);
// 3. stops by the roadside for 20 s: it goes quiet after the moving window
const before = r.buzzes.length; const tStop = r.now();
for (let i = 0; i < 20; i++) r.step(1000, 80, 0);
const during = r.buzzes.filter((b) => b.t > tStop + G.warnMovingMs + 1500).length;
ok(during === 0, `quiet once stopped (buzzes after window: ${during})`);
// 4. rides again, still wrong: buzzing resumes
const resumed = r.buzzes.length; for (let i = 0; i < 10; i++) r.step(1000 + i * 15, 80, 15);
ok(r.buzzes.length > resumed, 'buzzing resumes when moving again');
// 5. back on the road: clears and stays silent
for (let i = 0; i < 4; i++) r.step(1300 + i * 15, 0, 15);
const cleared = r.buzzes.length; for (let i = 0; i < 12; i++) r.step(1400 + i * 15, 0, 15);
ok(!r.state.wrongWay && r.buzzes.length === cleared, 'back on route: cleared and silent');

// 6. no route at all: heading away from the destination warns, repeats, and clears on turning back
r = rig({ withRoute: false });
for (let x = 1000; x < 1600; x += 15) r.step(x, 0, 15);             // approaching: nothing
ok(r.buzzes.length === 0 && !r.state.wrongWay, 'no route, approaching: silent');
for (let x = 1600; x > 1000; x -= 15) r.step(x, 0, 15);             // riding west, away from a destination at x=3000
ok(r.state.wrongWay === 'away', 'no route, riding away: flagged');
ok(r.buzzes.filter((b) => b.k === 'wrong').length >= 5, 'no route: repeats');
const mark = r.buzzes.length; for (let x = 1000; x < 1400; x += 15) r.step(x, 0, 15);   // turned back toward the destination
ok(!r.state.wrongWay, 'no route: turning back clears it');
const after = r.buzzes.length; for (let x = 1400; x < 1800; x += 15) r.step(x, 0, 15);
ok(r.buzzes.length === after, 'no route: silent after clearing');
console.log(`${pass} passed${fail ? `, ${fail} failed` : ''}`); process.exit(fail ? 1 : 0);
