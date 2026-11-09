"""The toll banner at phone sizes: text keeps the width, buttons sit in their own row below it, nothing overlaps or
overflows, every button is a proper tap target. Real touring screen + mocked routing (see touring_smoke_test.py).
Screenshots go to /tmp/banner-<w>x<h>.png."""
import json, re, sys
from urllib.parse import unquote, urlsplit
from playwright.sync_api import sync_playwright

def route_json(pts):
    legs = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        legs.append({'steps': [
            {'maneuver': {'type': 'depart', 'location': a}, 'name': 'Jalan Tol Cipularang', 'distance': 40000, 'intersections': [{'classes': ['toll', 'motorway']}], 'geometry': {'type': 'LineString', 'coordinates': [a, mid]}},
            {'maneuver': {'type': 'arrive', 'location': b}, 'name': '', 'distance': 0, 'intersections': [{'classes': []}], 'geometry': {'type': 'LineString', 'coordinates': [b, b]}}]})
    return {'code': 'Ok', 'routes': [{'distance': 685000, 'duration': 30000, 'geometry': {'type': 'LineString', 'coordinates': pts}, 'legs': legs}]}

def handle(route):
    url = route.request.url
    pts = [tuple(map(float, p.split(','))) for p in re.search(r'/route/v1/[^/]+/([^?]+)', unquote(urlsplit(url).path)).group(1).split(';')]
    if 'exclude=' in url: route.fulfill(status=400, content_type='application/json', body=json.dumps({'code': 'InvalidValue'}))
    else: route.fulfill(status=200, content_type='application/json', body=json.dumps(route_json(pts)))

SIZES = [(320, 640), (360, 740), (412, 800), (740, 360), (1280, 720)]
fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h) in SIZES:
        ctx = b.new_context(viewport={'width': w, 'height': h}, geolocation={'latitude': -6.8419, 'longitude': 107.4549, 'accuracy': 12}, permissions=['geolocation'])
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'.*router\.project-osrm\.org.*'), handle)
        pg.route(re.compile(r'.*(tile|openfreemap|openmaptiles|nominatim|overpass|open-meteo|maptiler|arcgis|cartocdn|openstreetmap)\..*'), lambda r: r.abort())
        pg.goto('http://localhost:8099/tests/touring-smoke.html'); pg.wait_for_function('window.__ready || window.__error', timeout=20000)
        banner = pg.locator('.banner--danger', has_text='lewat jalan tol'); banner.wait_for(timeout=20000)
        pg.wait_for_timeout(300)
        m = pg.evaluate("""() => {
          const b = document.querySelector('.banner--danger'); const r = (e) => { const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, r: x.right, b: x.bottom, w: x.width, h: x.height }; };
          const body = b.querySelector('.banner__body'), act = b.querySelector('.banner__actions'), btns = [...b.querySelectorAll('.btn')];
          return { banner: r(b), body: r(body), act: r(act), btns: btns.map((e) => ({ ...r(e), text: e.innerText })), overflowX: b.scrollWidth > b.clientWidth + 1, vw: innerWidth };
        }""")
        tag = f'{w}x{h}'
        check(m['body']['w'] / m['banner']['w'] >= 0.6, f'{tag}: the text keeps at least 60% of the banner width ({m["body"]["w"]:.0f} of {m["banner"]["w"]:.0f}px)')
        check(m['act']['t'] >= m['body']['b'] - 1, f'{tag}: the buttons sit below the text, not over it')
        check(not m['overflowX'], f'{tag}: no horizontal overflow')
        check(all(x['h'] >= 43.5 for x in m['btns']), f'{tag}: every button is at least 44px tall ({[round(x["h"]) for x in m["btns"]]})')
        check(all(x['l'] >= m['banner']['l'] - 1 and x['r'] <= m['banner']['r'] + 1 for x in m['btns']), f'{tag}: buttons stay inside the banner')
        check(all(x['w'] >= 80 for x in m['btns']), f'{tag}: no squeezed buttons ({[round(x["w"]) for x in m["btns"]]})')
        check(m['banner']['r'] <= m['vw'], f'{tag}: the banner fits the screen')
        check(not errs, f'{tag}: no page errors')
        pg.screenshot(path=f'/tmp/banner-{tag}.png'); ctx.close()
    b.close()
print(f'\n{"FAILED" if fails else "ALL OK"}: {len(fails)} failing'); sys.exit(1 if fails else 0)
