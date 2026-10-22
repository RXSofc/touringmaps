import { makeSnapper } from '../js/snap.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
// route heading due east along lat -6.9, then north
const east = [[-6.9, 107.0], [-6.9, 107.002], [-6.9, 107.004], [-6.898, 107.004]];
const sn = makeSnapper(east);
let b = sn.aheadBearing(-6.9, 107.0005, 120);
ok(Math.abs(b - 90) < 1, `east route should face ~90, got ${b}`);
// near the corner the look-ahead bends toward north
b = sn.aheadBearing(-6.9, 107.0035, 120);
ok(b > 0 && b < 90 || b < 45, `before the corner should lean north-east, got ${b}`);
// route heading south
const south = [[-6.9, 107.0], [-6.902, 107.0], [-6.904, 107.0]];
b = makeSnapper(south).aheadBearing(-6.9005, 107.0, 120);
ok(Math.abs(b - 180) < 1, `south route should face ~180, got ${b}`);
// far from the route: no opinion
ok(sn.aheadBearing(-6.95, 107.0, 120) === null, 'off route gives null');
// at the very end: no opinion
ok(sn.aheadBearing(-6.898, 107.004, 120) === null, 'route end gives null');
console.log(`${pass} passed${fail ? `, ${fail} failed` : ''}`);
process.exit(fail ? 1 : 0);
