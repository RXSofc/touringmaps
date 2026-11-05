"""Toll stretch (red dashes) and numbered stops on the map, 2D with the real vendored Leaflet and 3D with the same
fake MapLibre the other 3D test uses. Needs: python3 -m http.server 8099 in the project root."""
import re, sys
from playwright.sync_api import sync_playwright

src3d = open('tests/map3d_test.py').read()
FAKE = src3d.split('JS = r"""\nasync () => {', 1)[1].split("const { TouringMap3D } = await import('/js/map3d.js');", 1)[0]
FAKE = FAKE.replace("this.src={route:new Src(),route2:new Src(),accuracy:new Src()}", "this.src={route:new Src(),route2:new Src(),tollspans:new Src(),accuracy:new Src()}")
assert 'tollspans' in FAKE, 'fake MapLibre layout changed: update this test'

JS_2D = r"""
async () => {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const { TouringMap } = await import('/js/map.js');
  const m = new TouringMap(document.getElementById('m'), {});
  const route = Array.from({ length: 60 }, (_, i) => [-6.2 - i * 0.002, 106.8 + i * 0.002]);
  m.setRoute(route);
  const spans = [route.slice(10, 20), route.slice(30, 35)];
  m.setTollSpans(spans);
  ok(m.tollLayer.getLayers().length === 4, 'two spans = 2 x (casing + dashes), got ' + m.tollLayer.getLayers().length);
  const dashed = m.tollLayer.getLayers().filter((l) => l.options.dashArray);
  ok(dashed.length === 2 && dashed.every((l) => l.options.color === '#E11D2E'), 'red dashed lines');
  ok(m.map.hasLayer(m.tollLayer), 'toll layer on the map');
  m.setTollSpans([route.slice(0, 1), null, 'x']); ok(m.tollLayer.getLayers().length === 0, 'junk spans are ignored');
  m.setTollSpans(spans); m.setTollSpans(null); ok(m.tollLayer.getLayers().length === 0, 'null clears');
  m.setTollSpans(spans);
  m.setRouteVisible(false); ok(!m.map.hasLayer(m.tollLayer), 'hidden together with the route');
  m.setRouteVisible(true); ok(m.map.hasLayer(m.tollLayer), 'shown again');
  m.setViaPoints([{ latitude: -6.3, longitude: 106.9 }, { latitude: -6.5, longitude: 107.1 }]);
  let badges = [...document.querySelectorAll('#m .via-marker')];
  ok(badges.length === 2 && badges.map((b) => b.textContent).join() === '1,2', 'numbered badges 1,2: ' + badges.map((b) => b.textContent));
  const r = badges[0].getBoundingClientRect(); ok(Math.round(r.width) === 30 && Math.round(r.height) === 30, 'badge is 30x30, got ' + r.width + 'x' + r.height);
  ok(badges[0].getAttribute('aria-label') === 'Titik lewat 1', 'accessible label');
  m.setViaPoints([{ latitude: -6.3, longitude: 106.9 }]); ok(document.querySelectorAll('#m .via-marker').length === 1, 'replaces, does not stack');
  m.setViaPoints([]); ok(document.querySelectorAll('#m .via-marker').length === 0, 'empty list removes them');
  m.setViaPoints(null); m.setViaPoints(undefined);
  m.destroy();
  return fails;
}
"""

JS_3D = r"""
async () => {
""" + FAKE + r"""
  const { TouringMap3D } = await import('/js/map3d.js');
  const { buildStyle } = await import('/js/map-style.js');
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const st = buildStyle(); const ids = st.layers.map((l) => l.id);
  ok(!!st.sources.tollspans, 'style has the tollspans source');
  ok(ids.indexOf('toll-line') > ids.indexOf('route-line') && ids.indexOf('toll-casing') < ids.indexOf('toll-line'), 'toll dashes sit above the route line, casing below them');
  ok(new Set(ids).size === ids.length && st.layers.every((l) => l.type === 'background' || st.sources[l.source]), 'style stays consistent');
  const m = new TouringMap3D(document.getElementById('m'), {});
  await new Promise((r) => setTimeout(r, 30));
  m.setTollSpans([[[-6.2, 106.8], [-6.21, 106.81]], [[-6.3, 106.9], [-6.31, 106.91], [-6.32, 106.92]], [[-6.4, 107]]]);
  const fc = inst.src.tollspans.d;
  ok(fc && fc.features.length === 2, 'two usable spans reach the source, got ' + (fc && fc.features.length));
  ok(JSON.stringify(fc.features[0].geometry.coordinates) === JSON.stringify([[106.8, -6.2], [106.81, -6.21]]), 'coordinates are [lng,lat]');
  m.setTollSpans([]); ok(inst.src.tollspans.d.features.length === 0, 'empty clears');
  m.setTollSpans(null); ok(inst.src.tollspans.d.features.length === 0, 'null clears');
  m.setRouteVisible(false); ok(inst.vis['toll-line'] === 'none' && inst.vis['toll-casing'] === 'none', 'hidden with the route');
  m.setRouteVisible(true); ok(inst.vis['toll-line'] === 'visible', 'shown again');
  m.setViaPoints([{ latitude: -6.3, longitude: 106.9 }, { latitude: -6.5, longitude: 107.1 }]);
  let b = [...document.querySelectorAll('.via-marker')]; ok(b.length === 2 && b.map((x) => x.textContent).join() === '1,2', 'numbered badges 1,2');
  m.setViaPoints([{ latitude: -6.3, longitude: 106.9 }]); ok(document.querySelectorAll('.via-marker').length === 1, 'replaces, does not stack');
  m.setViaPoints([]); ok(document.querySelectorAll('.via-marker').length === 0, 'empty list removes them');
  m.setSkin(true); ok(inst.paint['toll-line:line-color'] === '#ff5e00', 'neon skin recolours the toll dashes, got ' + inst.paint['toll-line:line-color']);
  m.setSkin(false); ok(inst.paint['toll-line:line-color'] === '#E11D2E', 'and restores them');
  m.setViaPoints([{ latitude: -6.3, longitude: 106.9 }]); m.destroy(); ok(document.querySelectorAll('.via-marker').length === 0, 'destroy removes the stop badges');
  return fails;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    allfails = []
    for name, js, leaflet in (('2D (real Leaflet)', JS_2D, True), ('3D (fake MapLibre)', JS_3D, False)):
        pg = b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:8099/tests/map3d-fake.html')
        for css in ('tokens', 'base', 'layout'):
            try: pg.add_style_tag(url=f'/css/{css}.css')
            except Exception: pass
        if leaflet:
            pg.add_style_tag(url='/vendor/leaflet/leaflet.css'); pg.add_script_tag(url='/vendor/leaflet/leaflet.js')
        fails = pg.evaluate(js)
        print(f'{name}: {"OK" if not fails and not errs else "FAIL"}', fails, errs)
        allfails += fails + errs
    b.close()
sys.exit(1 if allfails else 0)
