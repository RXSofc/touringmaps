import { WrongWayWatch } from '../js/wrongway.js';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const dest = { latitude: -6.9, longitude: 107.6 };
// positions along a straight road heading north of the destination (moving away as latitude rises)
const fixAt = (dLat, speed = 10, accuracy = 8) => ({ latitude: -6.9 + dLat, longitude: 107.6, speed, accuracy });
const m = (meters) => meters / 111320;
let w = new WrongWayWatch();
// approaching: never alerts
for (let i = 0; i <= 20; i++) ok(!w.update(fixAt(m(2000 - i * 50)), dest), 'approaching must not alert');
// now turn and go away: alert only after 150 m beyond the closest approach
w = new WrongWayWatch();
w.update(fixAt(m(500)), dest); w.update(fixAt(m(300)), dest);
ok(!w.update(fixAt(m(400)), dest), '100 m beyond closest: not yet');
ok(w.update(fixAt(m(470)), dest), '170 m beyond closest: away');
ok(w.update(fixAt(m(600)), dest), 'keeps alerting while still going away');
// turning back by 60 m clears it
ok(!w.update(fixAt(m(520)), dest), 'turned back 80 m: cleared');
ok(!w.update(fixAt(m(500)), dest), 'stays cleared while approaching');
// standing still with GPS jitter never alerts or clears
w = new WrongWayWatch(); w.update(fixAt(m(300)), dest);
for (let i = 0; i < 30; i++) ok(!w.update(fixAt(m(300 + (i % 2) * 120), 0.2), dest), 'jitter while stopped: no alert');
// bad accuracy ignored
w = new WrongWayWatch(); w.update(fixAt(m(300)), dest);
ok(!w.update(fixAt(m(900), 10, 200), dest), 'poor accuracy fix ignored');
// new destination resets
w = new WrongWayWatch(); w.update(fixAt(m(300)), dest); w.update(fixAt(m(700)), dest);
ok(w.away, 'away before'); w.update(fixAt(m(700)), { latitude: -6.5, longitude: 107.6 }); ok(!w.away, 'destination change resets');
ok(!w.update(null, dest) && !w.update(fixAt(0), null), 'no fix / no destination');
console.log(`${pass} passed${fail ? `, ${fail} failed` : ''}`); process.exit(fail ? 1 : 0);
