import assert from 'node:assert';
import { cityLabel, regionFromNominatim, regionFromPhoton, regionName } from '../js/region.js';
import { weatherLine, describeWeather } from '../js/weather.js';
import { RegionWatch, pointAtAlong, project } from '../js/regionwatch.js';
import { buildPath } from '../js/guidance.js';
import { haversine } from '../js/geo.js';
let n = 0; const ok = (m) => console.log('PASS', m, ++n);

// ---- naming
assert.equal(cityLabel('Kabupaten Bandung Barat'), 'Kab. Bandung Barat');
assert.equal(cityLabel('Bandung Barat'), 'Kab. Bandung Barat');
assert.equal(cityLabel('Bandung', { isCity: true }), 'Kota Bandung');
assert.equal(cityLabel('Kota Cimahi', { isCity: true }), 'Kota Cimahi'); ok('labels: kab./kota prefixes');
let r = regionFromNominatim({ county: 'Kabupaten Bandung Barat', municipality: 'Kecamatan Cililin', village: 'Cililin', state: 'Jawa Barat' });
assert.equal(r.label, 'Kab. Bandung Barat'); assert.equal(r.area, 'Cililin'); assert.equal(regionName(r), 'Kab. Bandung Barat, Cililin'); ok('nominatim kabupaten + kecamatan');
r = regionFromNominatim({ city: 'Bandung', suburb: 'Coblong', state: 'Jawa Barat' }); assert.equal(regionName(r), 'Kota Bandung, Coblong'); ok('nominatim kota');
r = regionFromNominatim({ city: 'Bandung', suburb: 'Bandung', state: 'Jawa Barat' }); assert.equal(regionName(r), 'Kota Bandung'); ok('duplicate area name dropped');
assert.equal(regionFromNominatim({ state: 'Jawa Barat' }), null); assert.equal(regionFromNominatim(null), null); ok('no city -> null');
r = regionFromPhoton({ county: 'Bandung Barat', district: 'Cililin', state: 'West Java' }); assert.equal(regionName(r), 'Kab. Bandung Barat, Cililin'); ok('photon');

// ---- weather text
assert.equal(weatherLine({ code: 0, temp: 30, rainChance: 10 }), 'Cerah · 30°C');
assert.equal(weatherLine({ code: 3, temp: 27, rainChance: 70 }), 'Mendung · 27°C · peluang hujan 70%');
assert.equal(weatherLine({ code: 63, temp: 22, rainChance: 90 }), 'Hujan · 22°C');
assert.equal(weatherLine(null), ''); assert.equal(describeWeather(999), 'Berawan'); ok('weather line');

// ---- geometry helpers
const p = project(-6.9, 107, 90, 1000); assert.ok(Math.abs(haversine({ latitude: -6.9, longitude: 107 }, { latitude: p.lat, longitude: p.lng }) - 1000) < 2); assert.ok(Math.abs(p.lat + 6.9) < 1e-4); ok('project east 1 km');
const route = Array.from({ length: 201 }, (_, i) => [-6.9, 107 + i * 0.0009]);   // ~20 km, a point every ~100 m
const path = buildPath(route); const mid = pointAtAlong(path, path.total / 2); assert.ok(Math.abs(mid.lng - (107 + 100 * 0.0009)) < 1e-3); ok('pointAtAlong');

// ---- ride simulation
const BOUNDARY = 107 + 0.045;   // ~5 km east of the start
const A = { key: 'kab. a|jb', label: 'Kab. A', area: 'Aaa' }, B = { key: 'kab. b|jb', label: 'Kab. B', area: 'Bbb' };
function rig(cfgOver = {}) {
  let t = 1_000_000; const calls = []; const out = [];
  const w = new RegionWatch({
    cfg: { enabled: true, aheadM: 1500, recheckMoveM: 700, minGapMs: 30000, minSpeedMs: 3, headingConfirm: 2, hereEveryM: 3000, repeatSilenceMs: 1200000, popupMs: 7000, ...cfgOver },
    geocode: async (lat, lng) => { calls.push([lat, lng]); return lng < BOUNDARY ? A : B; },
    weather: async () => ({ temp: 30, code: 0, rainChance: 0 }),
    onAnnounce: (i) => out.push({ ...i, at: lastFix }),
    now: () => t
  });
  let lastFix = null;
  async function ride(fromLng, toLng, { coords = null, speed = 15, heading = 90, secs } = {}) {
    const step = (speed / 110400);    // degrees of longitude per second at this latitude
    for (let lng = fromLng; lng < toLng; lng += step) {
      lastFix = { latitude: -6.9, longitude: lng, speed, heading, accuracy: 8 };
      t += 1000; w.update(lastFix, coords);
      for (let k = 0; k < 6; k++) await new Promise((r) => setImmediate(r));
    }
  }
  return { w, calls, out, ride };
}
const distToBoundary = (fix) => haversine({ latitude: fix.latitude, longitude: fix.longitude }, { latitude: -6.9, longitude: BOUNDARY });

let g = rig(); await g.ride(107, 107.09, { coords: route });
assert.equal(g.out.length, 1); assert.equal(g.out[0].kind, 'ahead'); assert.equal(g.out[0].region.label, 'Kab. B'); assert.equal(g.out[0].weather.temp, 30);
const d = distToBoundary(g.out[0].at); assert.ok(d > 600 && d <= 1600, `announced ${d} m before the border`); ok(`with a route: one warning, ${Math.round(d)} m before the border, weather attached`);
assert.ok(g.calls.length <= 24, `geocoder calls: ${g.calls.length}`); ok(`modest traffic (${g.calls.length} geocoder calls for 10 km)`);

g = rig(); await g.ride(107, 107.09, { coords: null });
assert.equal(g.out.length, 1); assert.equal(g.out[0].kind, 'ahead');
const d2 = distToBoundary(g.out[0].at); assert.ok(d2 > 200 && d2 <= 1600, `heading mode: ${d2}`); ok(`no route (heading): confirmed twice, ${Math.round(d2)} m before the border`);

g = rig(); await g.ride(107, 107.04, { coords: route, speed: 1 });
assert.equal(g.out.length, 0); assert.ok(g.calls.length <= 2); ok('crawling/parked: no look-ahead, no popups');

g = rig(); await g.ride(107, 107.09, { coords: null, speed: 15, heading: null });
assert.equal(g.out.length, 1); assert.equal(g.out[0].kind, 'entered'); ok('no heading and no route: "Memasuki" once after the fact');

g = rig(); await g.ride(107, 107.09, { coords: route }); const before = g.out.length; await g.ride(107.09, 107.13, { coords: route });
assert.equal(g.out.length, before); ok('same region is not announced twice');

// geocoder failure must not throw or spam
let t2 = 1e6; let tries = 0; const out2 = [];
const w2 = new RegionWatch({ cfg: { enabled: true, aheadM: 1500, recheckMoveM: 700, minGapMs: 30000, minSpeedMs: 3, headingConfirm: 2, hereEveryM: 3000, repeatSilenceMs: 1e6, popupMs: 7000 },
  geocode: async () => { tries++; throw new Error('429'); }, weather: async () => null, onAnnounce: (i) => out2.push(i), now: () => t2 });
for (let i = 0; i < 20; i++) { t2 += 1000; w2.update({ latitude: -6.9, longitude: 107 + i * 0.0001, speed: 15, heading: 90 }, null); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); }
assert.equal(out2.length, 0); assert.equal(tries, 1); ok('geocoder errors: silent, backs off 60 s');

// weather failing still gives the region line
const w3 = new RegionWatch({ cfg: { enabled: true, aheadM: 1500, recheckMoveM: 700, minGapMs: 0, minSpeedMs: 3, headingConfirm: 1, hereEveryM: 3000, repeatSilenceMs: 1e6, popupMs: 7000 },
  geocode: async (lat, lng) => (lng < BOUNDARY ? A : B), weather: async () => { throw new Error('offline'); }, onAnnounce: (i) => out2.push(i), now: () => (t2 += 1000) });
w3.update({ latitude: -6.9, longitude: BOUNDARY - 0.01, speed: 15, heading: 90 }, null); for (let k = 0; k < 10; k++) await new Promise((r) => setImmediate(r));
w3.last = null; w3.update({ latitude: -6.9, longitude: BOUNDARY - 0.012, speed: 15, heading: 90 }, null); for (let k = 0; k < 10; k++) await new Promise((r) => setImmediate(r));
assert.ok(out2.length === 1 && out2[0].weather === null); ok('weather offline: region still announced without weather');
console.log(`\n${n} passed`);
