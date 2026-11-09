"""SPBU terdekat on the REAL touring screen: menu row -> sheet with the 5 nearest -> markers -> spoken line -> Maps link,
plus the widening radius, the retry after an error, an empty area, no GPS fix, voice off and a 320 px phone.
Mocked Overpass (nothing leaves the machine). Needs the http server on :8099 (python3 tests/run_browser_tests.py starts it)."""
import json, math, re, sys
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

ME = (-6.8419, 107.4549)          # the fake GPS fix (Playwright cannot set heading/speed, so directions are compass words)
SPEECH = """
window.__said = [];
class U { constructor(t) { this.text = t; this.lang = 'id-ID'; } }
window.SpeechSynthesisUtterance = U;
// speechSynthesis is a read-only accessor on window: a plain assignment would be ignored
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 10); }, cancel() {}, pause() {}, resume() {},
  getVoices() { return [{ name: 'ID Voice', lang: 'id-ID', default: true }]; }, addEventListener() {}, removeEventListener() {} } });
localStorage.setItem('tt.speech', '1');
"""

def at(m_north, m_east):
    return (ME[0] + m_north / 111195, ME[1] + m_east / (111195 * math.cos(math.radians(ME[0]))))

# metres north / east of the rider; names say where they are
STATIONS = [('SPBU Utara 34-111', 400, 0), ('SPBU Timur 34-222', 0, 900), ('SPBU Selatan 34-333', -1500, 0), ('SPBU Barat 34-444', 0, -2100), ('SPBU Tenggara 34-555', -2000, 2000), ('SPBU Jauh 34-666', 2600, 0)]

def elements(upto_m):
    out = []
    for i, (name, n, e) in enumerate(STATIONS):
        lat, lng = at(n, e)
        if math.hypot(n, e) <= upto_m:
            out.append({'type': 'node', 'id': i + 1, 'lat': lat, 'lon': lng, 'tags': {'name': name, 'brand': 'Pertamina'}})
    return out

class Overpass:
    def __init__(self, plan): self.plan = plan; self.calls = []
    def __call__(self, route):
        body = unquote(route.request.post_data or '')
        radius = int(re.search(r'around:(\d+),', body).group(1)) if 'around:' in body else 0
        near_me = 'nwr["amenity"="fuel"](around:%d,%.5f,%.5f)' % (radius, ME[0], ME[1]) in body
        self.calls.append({'radius': radius, 'near_me': near_me, 'url': route.request.url})
        step = self.plan(len(self.calls), radius)
        if step == 'fail': route.fulfill(status=500, body='oops')
        else: route.fulfill(status=200, content_type='application/json', body=json.dumps({'elements': step}))

fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

def open_page(b, plan, *, gps=True, voice=True, size=(360, 740)):
    ctx = b.new_context(viewport={'width': size[0], 'height': size[1]}, **({'geolocation': {'latitude': ME[0], 'longitude': ME[1], 'accuracy': 12}, 'permissions': ['geolocation']} if gps else {}))
    if voice: ctx.add_init_script(SPEECH)
    else: ctx.add_init_script("window.__said = [];")
    pg = ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    ov = Overpass(plan); pg.ov = ov
    pg.route(re.compile(r'.*(overpass-api\.de|overpass\.kumi\.systems).*'), ov)
    pg.route(re.compile(r'.*router\.project-osrm\.org.*'), lambda r: r.abort())
    pg.route(re.compile(r'.*(tile|openfreemap|openmaptiles|nominatim|open-meteo|maptiler|arcgis|cartocdn|openstreetmap)\..*'), lambda r: r.abort())
    pg.goto('http://localhost:8099/tests/touring-smoke.html'); pg.wait_for_function('window.__ready || window.__error', timeout=20000)
    err = pg.evaluate('window.__error')
    if err: print('MOUNT ERROR:', err[:800]); sys.exit(2)
    return ctx, pg

def open_nearby(pg):
    pg.locator('button[aria-label="Map menu"]').click()
    pg.locator('.mi', has_text='SPBU terdekat').click(timeout=8000)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- A: the normal case
    ctx, pg = open_page(b, lambda n, r: elements(r))
    pg.wait_for_function('window.__tree && 1', timeout=5000)
    pg.wait_for_timeout(1500)                      # first GPS fix
    open_nearby(pg)
    sheet = pg.locator('.sheet', has_text='SPBU terdekat'); sheet.wait_for(timeout=8000)
    pg.wait_for_function("document.querySelectorAll('.nearby__row').length === 5", timeout=10000)
    names = pg.evaluate("[...document.querySelectorAll('.nearby__name')].map(e => e.textContent.trim())")
    check(names == ['SPBU Utara 34-111', 'SPBU Timur 34-222', 'SPBU Selatan 34-333', 'SPBU Barat 34-444', 'SPBU Jauh 34-666'], 'the 5 nearest, nearest first: %s' % names)
    check(len(pg.ov.calls) == 1 and pg.ov.calls[0]['radius'] == 3000 and pg.ov.calls[0]['near_me'], 'one Overpass request, 3 km, centred on the rider: %s' % pg.ov.calls)
    rows = pg.evaluate("[...document.querySelectorAll('.nearby__row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
    check('±' in rows[0] and 'di arah utara' in rows[0] and re.search(r'4\d0 m', rows[0]) is not None, 'row 1: ± distance and compass direction: %r' % rows[0])
    check('di arah timur' in rows[1] and '900 m' in rows[1].replace('±', '').replace(' ', ' '), 'row 2: east, about 900 m: %r' % rows[1])
    links = pg.evaluate("[...document.querySelectorAll('a.nearby__maps')].map(a => ({ href: a.href, target: a.target, rel: a.rel, h: a.getBoundingClientRect().height, text: a.textContent.trim() }))")
    check(len(links) == 5 and all('travelmode=two-wheeler' in l['href'] and 'destination=' in l['href'] for l in links), 'every row has a "Buka di Maps" link in motorcycle mode')
    check(all(l['target'] == '_blank' and 'noopener' in l['rel'] for l in links), 'the links open a new tab safely (noopener)')
    check(all(l['h'] >= 43.5 for l in links), 'tap targets are at least 44 px: %s' % [round(l['h']) for l in links])
    check(abs(float(re.search(r'destination=(-?[\d.]+)%2C', links[0]['href']).group(1)) - at(400, 0)[0]) < 0.001, 'the first link points at the first station')
    check(pg.evaluate("document.querySelectorAll('.fuel-marker--nearby').length") == 5, 'five numbered markers on the map')
    check(pg.evaluate("[...document.querySelectorAll('.fuel-marker--nearby')].map(e => e.textContent.trim()).join(',')") == '1,2,3,4,5', 'numbered 1 to 5')
    said = pg.evaluate('window.__said')
    check(len(said) == 1 and 'SPBU Pertamina' in said[0] and 'meter' in said[0] and 'di arah utara' in said[0], 'the nearest one is read aloud: %s' % said)
    check('OpenStreetMap' in sheet.inner_text() and '±' in sheet.inner_text(), 'the sheet says the data is OpenStreetMap and the distance is approximate')
    pg.locator('.sheet .btn--cancel').click(); pg.wait_for_function("!document.querySelector('.sheet')", timeout=3000)
    check(pg.evaluate("document.querySelectorAll('.fuel-marker--nearby').length") == 5, 'the markers stay after the sheet is closed')
    open_nearby(pg); pg.wait_for_function("document.querySelectorAll('.nearby__row').length === 5", timeout=5000)
    check(len(pg.ov.calls) == 1, 'reopening within 60 s uses the cache (no new request)')
    check(not pg.errs, 'no page errors: %s' % pg.errs); ctx.close()

    # ---- B: too few stations nearby: the radius widens
    ctx, pg = open_page(b, lambda n, r: elements(r) if r > 3000 else elements(500)); pg.wait_for_timeout(1500)
    open_nearby(pg); pg.wait_for_function("document.querySelectorAll('.nearby__row').length === 5", timeout=10000)
    check([c['radius'] for c in pg.ov.calls] == [3000, 8000], 'radius widened 3 km -> 8 km: %s' % [c['radius'] for c in pg.ov.calls])
    check('8 km' in pg.locator('.sheet').inner_text(), 'the sheet says it searched within 8 km'); ctx.close()

    # ---- C: Overpass fails (both mirrors), then "Coba lagi" works
    ctx, pg = open_page(b, lambda n, r: 'fail' if n <= 2 else elements(r)); pg.wait_for_timeout(1500)
    open_nearby(pg)
    pg.locator('.sheet', has_text='Gagal mencari SPBU').wait_for(timeout=10000)
    check(pg.evaluate("document.querySelectorAll('.nearby__row').length") == 0, 'no stale list while it failed')
    pg.locator('.sheet button', has_text='Coba lagi').click()
    pg.wait_for_function("document.querySelectorAll('.nearby__row').length === 5", timeout=10000)
    check(True, '"Coba lagi" recovers and shows the list'); ctx.close()

    # ---- D: nothing within 20 km
    ctx, pg = open_page(b, lambda n, r: []); pg.wait_for_timeout(1500)
    open_nearby(pg)
    pg.locator('.sheet', has_text='Tidak ada SPBU dalam 20 km').wait_for(timeout=10000)
    check(pg.evaluate("document.querySelectorAll('.fuel-marker--nearby').length") == 0 and [c['radius'] for c in pg.ov.calls] == [3000, 8000, 20000], 'empty area: said so, no markers, all 3 radii tried')
    check(pg.evaluate('window.__said.length') == 0, 'nothing is read aloud when there is nothing to say'); ctx.close()

    # ---- E: no GPS fix. The app's own GPS gate covers every control without a position, so the sheet is
    #         mounted directly: it must say so and never call the network.
    ctx, pg = open_page(b, lambda n, r: elements(r)); pg.wait_for_timeout(500)
    res = pg.evaluate("""async () => {
      const { openNearbyFuelSheet } = await import('/js/views/nearbyFuelSheet.js');
      let searched = 0;
      const sh = openNearbyFuelSheet({ getFix: () => null, search: async () => { searched++; return { stations: [], radiusM: 3000 }; }, directionOf: () => '', mapsLink: () => '#' });
      await new Promise((r) => setTimeout(r, 100));
      const text = [...document.querySelectorAll('.sheet')].pop().innerText;
      const retry = [...document.querySelectorAll('.sheet button')].some((x) => x.textContent.includes('Coba lagi'));
      sh.close(); return { text, searched, retry };
    }""")
    check('Belum ada posisi GPS' in res['text'] and res['retry'], 'no fix: the sheet says so and offers "Coba lagi": %r' % res['text'][:80])
    check(res['searched'] == 0 and len(pg.ov.calls) == 0, 'without a position nothing is searched or requested'); ctx.close()

    # ---- F: voice off: the list still shows, nothing is spoken
    ctx, pg = open_page(b, lambda n, r: elements(r), voice=False); pg.wait_for_timeout(1500)
    open_nearby(pg); pg.wait_for_function("document.querySelectorAll('.nearby__row').length === 5", timeout=10000)
    check(pg.evaluate('window.__said.length') == 0, 'voice off: no speech, the list is still there'); ctx.close()

    # ---- G: a 320 px phone
    ctx, pg = open_page(b, lambda n, r: elements(r), size=(320, 640)); pg.wait_for_timeout(1500)
    open_nearby(pg); pg.wait_for_function("document.querySelectorAll('.nearby__row').length === 5", timeout=10000); pg.wait_for_timeout(300)
    m = pg.evaluate("""() => { const s = document.querySelector('.sheet'); const rows = [...document.querySelectorAll('.nearby__row')];
      return { sheetW: s.getBoundingClientRect().width, vw: innerWidth, overflowX: s.scrollWidth > s.clientWidth + 1,
               rowsOk: rows.every((r) => r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().right <= innerWidth + 1),
               btnOk: [...document.querySelectorAll('a.nearby__maps')].every((a) => { const x = a.getBoundingClientRect(); return x.width >= 80 && x.right <= innerWidth + 1 && x.left >= 0; }) } }""")
    check(not m['overflowX'] and m['rowsOk'] and m['btnOk'] and m['sheetW'] <= m['vw'], '320 px: nothing overflows, buttons stay on screen: %s' % m)
    pg.screenshot(path='/tmp/nearby-320x640.png'); ctx.close()
    b.close()

print(f'\n{"FAILED" if fails else "ALL OK"}: {len(fails)} failing'); sys.exit(1 if fails else 0)
