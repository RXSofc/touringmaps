import { makeSnapper } from '../js/snap.js';
import { routeColorAt, ROUTE_STOPS } from '../js/route-style.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const M = 111320;
// straight road north, 1 km, a point every 50 m
const coords = Array.from({ length: 21 }, (_, i) => [-6.2 + (i * 50) / M, 106.8]);
const sn = makeSnapper(coords);
// 4 m east of the road, accuracy 5 m -> reach 12 m, 4 <= 4.8 -> fully on the line
let p = sn.apply({ lat: -6.2 + 300 / M, lng: 106.8 + 4 / (M * Math.cos(6.2 * Math.PI / 180)) }, 5);
ok(Math.abs(p.lng - 106.8) < 1e-9, 'snapped onto the line (lng ' + p.lng + ')');
ok(Math.abs((p.lat + 6.2) * M - 300) < 0.5, 'keeps its position along the road');
// 10 m off, reach 12 -> partial pull (between 0 and 1)
const east10 = 10 / (M * Math.cos(6.2 * Math.PI / 180));
p = sn.apply({ lat: -6.2 + 300 / M, lng: 106.8 + east10 }, 5);
ok(p.lng > 106.8 && p.lng < 106.8 + east10, 'partial pull at 10 m');
// 40 m off -> untouched (another road)
const east40 = 40 / (M * Math.cos(6.2 * Math.PI / 180));
p = sn.apply({ lat: -6.2 + 300 / M, lng: 106.8 + east40 }, 5);
ok(Math.abs(p.lng - (106.8 + east40)) < 1e-12, 'far away stays put');
// bad accuracy widens the reach to at most 30 m
const east25 = 25 / (M * Math.cos(6.2 * Math.PI / 180));
p = sn.apply({ lat: -6.2 + 300 / M, lng: 106.8 + east25 }, 40);
ok(p.lng < 106.8 + east25, 'low accuracy: pulled in from 25 m');
// continuity: sweeping the offset never jumps more than 1 m per 0.5 m step
let prev = null; let maxJump = 0;
for (let d = 0; d <= 40; d += 0.5) { const q = sn.apply({ lat: -6.2 + 300 / M, lng: 106.8 + d / (M * Math.cos(6.2 * Math.PI / 180)) }, 5); const e = (q.lng - 106.8) * M * Math.cos(6.2 * Math.PI / 180); if (prev !== null) maxJump = Math.max(maxJump, Math.abs(e - prev)); prev = e; }
ok(maxJump < 1.5, 'no pop when approaching/leaving the line, max step ' + maxJump.toFixed(2));
ok(makeSnapper([]).apply({ lat: 1, lng: 2 }, 5).lat === 1, 'no route: unchanged');
// colours
ok(routeColorAt(0) === ROUTE_STOPS[0][1].toLowerCase() && routeColorAt(1) === ROUTE_STOPS[2][1].toLowerCase(), 'gradient ends');
const mid = routeColorAt(0.55); ok(mid === ROUTE_STOPS[1][1].toLowerCase(), 'gradient middle ' + mid);
ok(/^#[0-9a-f]{6}$/.test(routeColorAt(0.8)), 'valid hex');
console.log(fails ? fails + ' FAILED' : 'route snap + colours: all passed'); process.exit(fails ? 1 : 0);
