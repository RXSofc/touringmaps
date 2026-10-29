// The skin table must match the real style: every "default" value equals what buildStyle() paints,
// every layer id exists, and the neon values are valid hex colours / expressions.
import { buildStyle, SKIN_OPS, SKIN_GLOW_LAYERS, NEON } from '../js/map-style.js';
globalThis.window = globalThis;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const style = buildStyle();
const byId = new Map(style.layers.map((l) => [l.id, l]));
for (const [id, prop, off, neon] of SKIN_OPS) {
  const l = byId.get(id);
  ok(!!l, `layer exists: ${id}`);
  if (!l) continue;
  const cur = l.paint?.[prop];
  ok(JSON.stringify(cur) === JSON.stringify(off), `default matches style: ${id}.${prop} (${JSON.stringify(cur)} vs ${JSON.stringify(off)})`);
  ok(neon !== undefined && JSON.stringify(neon) !== JSON.stringify(off), `neon differs: ${id}.${prop}`);
}
for (const id of SKIN_GLOW_LAYERS) { const l = byId.get(id); ok(l && l.layout.visibility === 'none', `glow hidden by default: ${id}`); }
const hexes = JSON.stringify(SKIN_OPS.map((o) => o[3])).match(/#[0-9a-fA-F]{6}/g) || [];
ok(hexes.length > 40, 'neon colours present');
ok(NEON.cyan === '#00f0ff' && NEON.magenta === '#ff007f' && NEON.yellow === '#fcee0a' && NEON.void === '#0d0e15', 'user palette values kept');
// the route must keep the brightest colours: the neon route gradient starts at magenta
const rg = SKIN_OPS.find((o) => o[0] === 'route-line')[3];
ok(JSON.stringify(rg).includes('#ff007f'), 'route is neon magenta');
// the soft hills: exaggeration is small
ok(byId.get('hillshade').paint['hillshade-exaggeration'] <= 0.35, 'hills are soft');
console.log(`${pass} passed${fail ? `, ${fail} FAILED` : ''}`); process.exit(fail ? 1 : 0);
