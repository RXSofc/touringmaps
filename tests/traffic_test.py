"""The optional TomTom traffic layer. 2D: the REAL touring screen with the real Leaflet (menu row only with a key, toggle,
tile requests, credit, persistence, legend, quota/403 failure switches it off). 3D: the real map3d.js against the same fake
MapLibre the other 3D tests use (source + layer, under the route, replaced/removed, applied on load, health events).
Mocked TomTom, nothing leaves the machine. Needs the http server on :8099 (python3 tests/run_browser_tests.py starts it)."""
import re, sys, base64
from playwright.sync_api import sync_playwright

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
GEO = {'geolocation': {'latitude': -6.8419, 'longitude': 107.4549, 'accuracy': 12}, 'permissions': ['geolocation']}

src3d = open('tests/map3d_test.py').read()
FAKE = src3d.split('JS = r"""\nasync () => {', 1)[1].split("const { TouringMap3D } = await import('/js/map3d.js');", 1)[0]
OLD_GET = "getLayer(){ return {}; }"
assert OLD_GET in FAKE, 'fake MapLibre changed: update this test'
FAKE = FAKE.replace(OLD_GET, """getLayer(id){ if (id === 'traffic-flow') return (this.layerList || []).some((x) => x.layer.id === 'traffic-flow') ? {} : undefined; return {}; }
    addSource(id, spec){ (this.sources ||= {})[id] = spec; this.src[id] = new Src(); }
    removeSource(id){ if (this.sources) delete this.sources[id]; delete this.src[id]; }
    addLayer(layer, before){ (this.layerList ||= []).push({ layer, before }); }
    removeLayer(id){ this.layerList = (this.layerList || []).filter((x) => x.layer.id !== id); }""")

JS_3D = r"""
async () => {
""" + FAKE + r"""
  const { TouringMap3D } = await import('/js/map3d.js');
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const layers = () => (inst.layerList || []).filter((x) => x.layer.id === 'traffic-flow');
  let oks = 0, bads = 0;
  const opts = (url) => ({ url, tileSize: 512, minZoom: 9, opacity: 0.85, attribution: '© TomTom', onOk: () => oks++, onFail: () => bads++ });

  const early = new TouringMap3D(document.getElementById('m'), {});
  early.setTrafficLayer(opts('https://t/{z}/{x}/{y}.png?key=A'));       // before the style is loaded
  ok(layers().length === 0, 'nothing is added before the map has loaded');
  await new Promise((r) => setTimeout(r, 30));
  ok(inst.sources && inst.sources.traffic && inst.sources.traffic.type === 'raster', 'applied on load: a raster source');
  ok(JSON.stringify(inst.sources.traffic.tiles) === JSON.stringify(['https://t/{z}/{x}/{y}.png?key=A']) && inst.sources.traffic.tileSize === 512, 'with the tile URL template and 512 px tiles');
  ok(inst.sources.traffic.attribution === '© TomTom', 'and the TomTom credit');
  ok(layers().length === 1 && layers()[0].before === 'route-casing', 'one raster layer, drawn UNDER the route');
  ok(layers()[0].layer.source === 'traffic' && layers()[0].layer.paint['raster-opacity'] === 0.85 && layers()[0].layer.minzoom === 8, 'its opacity and a minimum zoom one below the 2D map (MapLibre zooms differ by one)');

  early.setTrafficLayer(opts('https://t/{z}/{x}/{y}.png?key=B'));
  ok(layers().length === 1 && inst.sources.traffic.tiles[0].endsWith('key=B'), 'a new URL (e.g. the dark NEON style) replaces the layer instead of stacking another');
  early.refreshTraffic();
  ok(layers().length === 1, 'refresh re-creates it, still one layer');

  inst.h.error({ sourceId: 'other' }); ok(bads === 0, 'errors of other sources are ignored');
  inst.h.error({ sourceId: 'traffic' }); ok(bads === 1, 'a traffic tile error is reported');
  for (let i = 0; i < 20; i++) inst.h.error({ sourceId: 'traffic', error: { message: 'tilejson style openmaptiles' } });
  ok(early.gaveUp !== true, 'traffic tile errors can never push the 3D map back to the flat map (they are not map errors)');
  bads = 0; inst.h.error({ sourceId: 'traffic' }); ok(bads === 1, 'and each one is still reported to the traffic layer');
  inst.h.data({ sourceId: 'traffic', tile: {} }); ok(oks === 1, 'a loaded traffic tile is reported');
  inst.h.data({ sourceId: 'traffic' }); inst.h.data({ sourceId: 'route', tile: {} }); ok(oks === 1, 'source metadata and other sources do not count as a loaded tile');

  early.setTrafficLayer(null);
  ok(layers().length === 0 && !(inst.sources && inst.sources.traffic), 'null removes the layer and its source');
  early.setTrafficLayer(null); early.refreshTraffic(); ok(true, 'removing twice / refreshing nothing does not throw');
  early.setTrafficLayer(opts('https://t/{z}/{x}/{y}.png?key=C')); early.destroy(); ok(true, 'destroy with the layer on does not throw');
  return fails;
}
"""

fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

def page_for(b, key=None, status=200, voice=False):
    ctx = b.new_context(viewport={'width': 412, 'height': 800}, **GEO)
    pg = ctx.new_page(); pg.errs = []; pg.tiles = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    def tomtom(route):
        pg.tiles.append(route.request.url)
        if status == 200: route.fulfill(status=200, content_type='image/png', body=PNG)
        else: route.fulfill(status=status, body='over the limit')
    pg.route(re.compile(r'.*api\.tomtom\.com.*'), tomtom)
    pg.route(re.compile(r'.*router\.project-osrm\.org.*'), lambda r: r.abort())
    pg.route(re.compile(r'.*(overpass|openfreemap|openmaptiles|nominatim|open-meteo|maptiler|arcgis|cartocdn|tile\.openstreetmap)\..*'), lambda r: r.abort())
    pg.goto('http://localhost:8099/tests/touring-smoke.html' + (f'?trafficKey={key}' if key else ''))
    pg.wait_for_function('window.__ready || window.__error', timeout=20000)
    err = pg.evaluate('window.__error')
    if err: print('MOUNT ERROR:', err[:800]); sys.exit(2)
    pg.wait_for_timeout(1200)
    # the start view is zoomed far out (below the layer's minimum zoom on purpose): centre on the rider to zoom in
    pg.locator('button[aria-label="Center on my position"]').click(); pg.wait_for_timeout(800)
    return ctx, pg

def menu(pg):
    pg.locator('button[aria-label="Map menu"]').click()
    pg.locator('.mi', has_text='SPBU terdekat').wait_for(state='visible', timeout=5000)   # the menu is really open

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- 1: no key = the feature does not exist
    ctx, pg = page_for(b)
    menu(pg)
    check(not pg.locator('.mi', has_text='Kemacetan').is_visible(), 'without a key there is no "Kemacetan" row in the menu')
    pg.locator('.mi', has_text='Map legend').click()
    check('Kemacetan' not in pg.locator('.legend').inner_text(), 'and the legend does not mention it')
    check(len(pg.tiles) == 0 and pg.evaluate("document.querySelectorAll('.traffic-tiles').length") == 0, 'no request to TomTom is ever made'); ctx.close()

    # ---- 2: with a key: toggle on, tiles, credit, legend, persistence, toggle off
    ctx, pg = page_for(b, key='TESTKEY')
    menu(pg)
    row = pg.locator('.mi', has_text='Kemacetan')
    check(row.is_visible() and row.get_attribute('aria-pressed') == 'false', 'with a key the row is there, OFF by default (visible=%s pressed=%s)' % (row.is_visible(), row.get_attribute('aria-pressed')))
    check(len(pg.tiles) == 0, 'nothing is requested while it is off (no quota burnt)')
    row.click()
    pg.wait_for_function("document.querySelectorAll('.traffic-tiles img').length > 0", timeout=10000)
    check(pg.locator('.mi', has_text='Kemacetan').get_attribute('aria-pressed') == 'true', 'toggled ON')
    pg.wait_for_timeout(500)
    good = [u for u in pg.tiles if re.search(r'/traffic/map/4/tile/flow/relative0/\d+/\d+/\d+\.png\?key=TESTKEY&tileSize=512', u)]
    check(len(good) >= 4 and len(good) == len(pg.tiles), 'tiles come from the relative0 flow endpoint with the key and tileSize=512 (%d requests)' % len(pg.tiles))
    zs = {int(re.search(r'/relative0/(\d+)/', u).group(1)) for u in good}
    check(len(zs) == 1, '512 px tiles are requested at ONE zoom level (the map zoom minus one): %s' % zs)
    check('TomTom' in pg.locator('.leaflet-control-attribution').inner_text(), 'the TomTom credit shows in the map attribution')
    check(pg.evaluate("localStorage.getItem('tt.traffic')") == '1', 'the choice is remembered')
    pg.locator('.mi', has_text='Map legend').click()
    check('Kemacetan' in pg.locator('.legend').inner_text(), 'the legend explains the colours')
    pg.reload(); pg.wait_for_function('window.__ready', timeout=20000); pg.wait_for_timeout(1500)
    pg.locator('button[aria-label="Center on my position"]').click(); pg.wait_for_timeout(800)   # zoom in again: the layer hides below its minimum zoom
    pg.wait_for_function("document.querySelectorAll('.traffic-tiles img').length > 0", timeout=10000)
    check(True, 'after a reload the layer is on again (remembered)')
    menu(pg); pg.locator('.mi', has_text='Kemacetan').click(); pg.wait_for_timeout(400)
    seen = len(pg.tiles); pg.wait_for_timeout(1200)
    check(pg.evaluate("document.querySelectorAll('.traffic-tiles img').length") == 0 and len(pg.tiles) == seen, 'toggled OFF: the layer is gone and no more requests')
    check(pg.evaluate("localStorage.getItem('tt.traffic')") == '0' and 'TomTom' not in pg.locator('.leaflet-control-attribution').inner_text(), 'off is remembered and the credit goes with it')
    check(not pg.errs, 'no page errors: %s' % pg.errs); ctx.close()

    # ---- 3: TomTom refuses (quota used up / wrong key): the layer switches itself off, the map keeps working
    ctx, pg = page_for(b, key='BADKEY', status=403)
    menu(pg); pg.locator('.mi', has_text='Kemacetan').click()
    pg.wait_for_function("localStorage.getItem('tt.traffic') === '0'", timeout=20000)
    check(True, 'every tile refused: the layer switches itself off')
    check(pg.locator('text=kemacetan').first.is_visible() or pg.evaluate("document.body.innerText.toLowerCase().includes('kemacetan')"), 'and says so')
    check(pg.evaluate("document.querySelectorAll('.traffic-tiles img').length") == 0, 'the failed tiles are removed')
    check(pg.locator('.leaflet-container').is_visible() and not pg.errs, 'the map is untouched, no page errors: %s' % pg.errs)
    seen = len(pg.tiles); pg.wait_for_timeout(1500); check(len(pg.tiles) == seen, 'and it stops asking TomTom'); ctx.close()

    # ---- 4: 3D (fake MapLibre)
    pg3 = b.new_page(); errs = []
    pg3.on('pageerror', lambda e: errs.append(str(e)))
    pg3.goto('http://localhost:8099/tests/map3d-fake.html')
    for f in pg3.evaluate(JS_3D): check(False, '3D: ' + f)
    check(not errs, '3D: no page errors %s' % errs)
    if not fails: print('PASS 3D layer: source, order under the route, replace, remove, refresh, health events')
    b.close()

print(f'\n{"FAILED" if fails else "ALL OK"}: {len(fails)} failing'); sys.exit(1 if fails else 0)
