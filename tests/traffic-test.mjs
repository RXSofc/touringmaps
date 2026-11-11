// The traffic layer's logic: is it available (key set?), the tile URL, the dark style for NEON, and the health
// watch that switches the layer off when every tile fails (quota used up / wrong key). Pure functions, no network.
import assert from 'node:assert';
globalThis.window = globalThis; globalThis.document = {};
const { MAP_CONFIG } = await import('../js/map-config.js');
const T = await import('../js/traffic.js');
let n = 0; const ok = (m) => console.log('PASS', m, ++n);

const base = MAP_CONFIG.traffic;
assert.ok(base && base.baseUrl.startsWith('https://api.tomtom.com/traffic/map/4/tile/flow') && base.tileSize === 512 && base.style === 'relative0' && base.darkStyle === 'relative0-dark'); ok('the default config points at the TomTom raster flow tiles, 512 px, relative0 (dark for NEON)');
assert.equal(T.trafficAvailable(), false); ok('out of the box the layer is NOT available: the app behaves as before until a key is set');

for (const bad of [undefined, null, {}, { ...base, apiKey: '' }, { ...base, apiKey: '   ' }, { ...base, apiKey: 'YOUR_TOMTOM_TILE_KEY' }, { ...base, apiKey: 'your_key_here_YOUR_' }, { ...base, baseUrl: '' }]) assert.equal(T.trafficAvailable(bad), false);
ok('no key / blank / placeholder / no base URL: not available');
const cfg = { ...base, apiKey: 'abc123' };
assert.equal(T.trafficAvailable(cfg), true); ok('a real-looking key: available');

const o = T.trafficLayerOptions({ cfg, neon: false });
assert.equal(o.url, 'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=abc123&tileSize=512'); ok('tile URL template: style, {z}/{x}/{y} placeholders untouched, key, tileSize');
assert.equal(o.tileSize, 512); assert.equal(o.minZoom, base.minZoom); assert.equal(o.attribution, '© TomTom'); assert.equal(o.opacity, base.opacity); ok('options carry tile size, minimum zoom, opacity and the TomTom credit');
assert.ok(T.trafficLayerOptions({ cfg, neon: true }).url.includes('/relative0-dark/')); ok('NEON skin: the dark style');
assert.ok(T.trafficLayerOptions({ cfg: { ...cfg, apiKey: 'a b&c=d' }, neon: false }).url.includes('key=a%20b%26c%3Dd&')); ok('the key is URL-encoded so odd characters cannot break the URL');
assert.equal(T.trafficLayerOptions({ cfg: { ...cfg, apiKey: '' }, neon: false }), null); ok('unavailable: no options at all (the map code then removes the layer)');
const cb = { onOk: () => 1, onFail: () => 2 };
const withCb = T.trafficLayerOptions({ cfg, neon: false, ...cb }); assert.equal(withCb.onOk, cb.onOk); assert.equal(withCb.onFail, cb.onFail); ok('tile ok / fail callbacks are passed through');

let tripped = 0; let h = new T.TrafficHealth({ onTrip: () => { tripped++; } });
for (let i = 0; i < 3; i++) h.fail(); assert.equal(tripped, 0); h.fail(); assert.equal(tripped, 1); ok('4 failed tiles (a whole phone screen) and none loaded: the layer is switched off (once)');
for (let i = 0; i < 20; i++) h.fail(); assert.equal(tripped, 1); ok('further failures after that do not trip it again');
tripped = 0; h = new T.TrafficHealth({ onTrip: () => { tripped++; } }); h.ok(); for (let i = 0; i < 30; i++) h.fail(); assert.equal(tripped, 0); ok('as soon as one tile loaded the key works: scattered failures never trip it');
tripped = 0; h = new T.TrafficHealth({ onTrip: () => { tripped++; }, maxFails: 3 }); h.fail(); h.fail(); h.fail(); assert.equal(tripped, 1); h.reset(); h.fail(); h.fail(); h.fail(); assert.equal(tripped, 2); ok('threshold is configurable and reset() re-arms the watch');
assert.doesNotThrow(() => new T.TrafficHealth({}).fail()); ok('no onTrip handler: nothing breaks');
console.log(`\n${n} passed`);
