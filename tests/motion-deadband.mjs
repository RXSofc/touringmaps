// Node: a rider standing still with noisy GPS must not move; a rider who rides off must.
import { MotionTrack } from '../js/motion.js';
const cfg = { extrapolateMs: 2500, easeMs: 280, snapMeters: 120, minSpeedMps: 1.0, deadbandMinM: 4, deadbandMaxM: 12 };
const M = 111320; let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const t = new MotionTrack(cfg); let now = 1e6;
t.setFix({ lat: -6.2, lng: 106.8, speed: 0, heading: null, accuracy: 3, measuredAt: now });
let maxDrift = 0; let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
for (let i = 1; i <= 120; i++) {   // 2 minutes, 1 fix per second, ±2.5 m noise, device speed unknown half the time
  now += 1000;
  t.setFix({ lat: -6.2 + (rnd() * 5) / M, lng: 106.8 + (rnd() * 5) / M, speed: i % 2 ? 0.2 : undefined, heading: undefined, accuracy: 4, measuredAt: now });
  for (let k = 0; k < 10; k++) { const s = t.sample(now + k * 100); maxDrift = Math.max(maxDrift, Math.hypot((s.lat + 6.2) * M, (s.lng - 106.8) * M * Math.cos(6.2 * Math.PI / 180))); ok(s.heading === null, 'no heading while standing'); }
}
ok(maxDrift < 0.01, `standing still: dot drifted ${maxDrift.toFixed(3)} m`);
// now ride north at 10 m/s
let lat = -6.2;
for (let i = 1; i <= 20; i++) { now += 1000; lat += 10 / M; t.setFix({ lat, lng: 106.8, speed: 10, heading: 0, accuracy: 4, measuredAt: now }); }
const s = t.sample(now + 100);
ok((s.lat + 6.2) * M > 150, `moving: dot followed (${((s.lat + 6.2) * M).toFixed(0)} m)`);
ok(s.heading !== null && (s.heading < 5 || s.heading > 355), `moving: heading north, got ${s.heading}`);
console.log(fails ? `${fails} FAILED` : 'motion deadband: all passed');
process.exit(fails ? 1 : 0);
