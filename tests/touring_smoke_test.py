"""Smoke test of the REAL touring screen: toll banner -> "Atur jalur" -> tap the map -> stop saved -> clean route.
Real js/views/touring.js, rooms.js, routing.js and Leaflet; in-memory Firebase; mocked OSRM. Needs the http server on :8099
(python3 -m http.server 8099 in the project root)."""
import json, re, sys
from urllib.parse import unquote, urlsplit
from playwright.sync_api import sync_playwright

def osrm(coords, toll):
    """A fake OSRM answer for a list of (lng,lat): one leg per consecutive pair, tolled or clean."""
    legs = []
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        cls = ['toll', 'motorway'] if toll and i == 0 else []
        legs.append({'steps': [
            {'maneuver': {'type': 'depart', 'location': a}, 'name': 'Jalan Tol Cipularang' if cls else 'Jalan Raya', 'distance': 40000, 'intersections': [{'classes': cls}], 'geometry': {'type': 'LineString', 'coordinates': [a, mid]}},
            {'maneuver': {'type': 'arrive', 'location': b}, 'name': '', 'distance': 0, 'intersections': [{'classes': []}], 'geometry': {'type': 'LineString', 'coordinates': [b, b]}}]})
    line = [c for c in coords]
    return {'code': 'Ok', 'routes': [{'distance': 80000 * (len(coords) - 1), 'duration': 5400 * (len(coords) - 1), 'geometry': {'type': 'LineString', 'coordinates': line}, 'legs': legs}]}

requests = []
def handle(route):
    url = route.request.url
    path = unquote(urlsplit(url).path)
    m = re.search(r'/route/v1/[^/]+/([^?]+)', path)
    pts = [tuple(map(float, p.split(','))) for p in m.group(1).split(';')]
    q = urlsplit(url).query
    via = len(pts) - 2
    requests.append({'stops': via, 'exclude': 'exclude=' in q})
    if 'exclude=' in q:       # like the public demo: the option is not supported
        route.fulfill(status=400, content_type='application/json', body=json.dumps({'code': 'InvalidValue', 'message': 'Exclude flag combination is not supported.'}))
    else:
        route.fulfill(status=200, content_type='application/json', body=json.dumps(osrm(pts, toll=(via == 0))))

fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 412, 'height': 800}, geolocation={'latitude': -6.8419, 'longitude': 107.4549, 'accuracy': 12}, permissions=['geolocation'])
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*router\.project-osrm\.org.*'), handle)
    pg.route(re.compile(r'.*(tile|openfreemap|openmaptiles|nominatim|overpass|open-meteo|maptiler|arcgis|cartocdn|openstreetmap)\..*'), lambda r: r.abort())
    pg.goto('http://localhost:8099/tests/touring-smoke.html')
    pg.wait_for_function('window.__ready || window.__error', timeout=20000)
    err = pg.evaluate('window.__error')
    if err: print('MOUNT ERROR:', err[:1500]); sys.exit(2)

    banner = pg.locator('.banner--danger', has_text='lewat jalan tol')
    try:
        banner.wait_for(timeout=20000)
    except Exception:
        print('DEBUG requests:', requests[:8])
        print('DEBUG alerts:', pg.evaluate("[...document.querySelectorAll('.banner, .navcard')].map(e => e.className + ' | ' + e.innerText.slice(0, 140))"))
        print('DEBUG text:', pg.evaluate("document.body.innerText.slice(0, 500)"), errs)
        sys.exit(3)
    check(True, 'the toll banner shows when the route is tolled (the demo refused exclude, the plain route has toll)')
    check('merah putus-putus' in banner.inner_text(), 'it says the toll stretch is marked on the map')
    check('tidak bisa menghindari tol' in banner.inner_text() and 'OSRM' in banner.inner_text(), 'it names the router and says it cannot avoid toll (the demo server): %r' % banner.inner_text()[:260])
    check(pg.locator('.banner--danger button', has_text='Atur jalur').count() == 1, 'the owner is offered "Atur jalur"')
    check(pg.locator('.leaflet-overlay-pane path[stroke-dasharray]').count() >= 1, 'the toll stretch is drawn as dashed red on the real map')
    check(pg.locator('.via-marker').count() == 0, 'no stop badges yet')

    pg.locator('.banner--danger button', has_text='Atur jalur').click()
    pick = pg.locator('.banner--info', has_text='Tap peta di jalan non-tol')
    pick.wait_for(timeout=5000)
    check('1 dari 3' in pick.inner_text(), 'pick mode explains it is stop 1 of 3')

    before = len(requests)
    box = pg.locator('.leaflet-container').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.68)
    try:
        pg.wait_for_function("document.querySelectorAll('.via-marker').length === 1", timeout=10000)
    except Exception:
        print('DEBUG dest:', pg.evaluate("JSON.stringify(window.__tree.rooms[window.__roomId].destination)"))
        print('DEBUG alerts:', pg.evaluate("[...document.querySelectorAll('.banner, .toast, [role=status], [role=alert]')].map(e => e.className + ' | ' + e.innerText.slice(0, 140))"))
        print('DEBUG click box:', box, 'requests:', requests[before:], errs)
        sys.exit(3)
    check(True, 'tapping the map adds a numbered stop badge')
    check(pg.evaluate("document.querySelector('.via-marker').textContent") == '1', 'the badge says 1')
    saved = pg.evaluate("JSON.stringify(window.__tree.rooms[window.__roomId].destination)")
    d = json.loads(saved)
    check(isinstance(d.get('via'), list) and len(d['via']) == 1 and -90 < d['via'][0]['latitude'] < 90, 'the stop is saved on the room destination: ' + json.dumps(d.get('via')))
    check(d.get('updatedBy') == 'u1abc', 'saved together with updatedBy (what the database rules require)')
    info = pg.locator('.banner--info', has_text='titik lewat')
    info.wait_for(timeout=15000)
    check(pg.locator('.banner--danger').count() == 0, 'the stop makes the route clean: no toll banner while the stop is in place')
    check('1 titik lewat' in info.inner_text(), 'an info banner tells the rider about the group stop')
    for _ in range(60):
        if any(r['stops'] == 1 for r in requests[before:]): break
        pg.wait_for_timeout(250)
    check(any(r['stops'] == 1 for r in requests[before:]), 'the new route request carried the stop (from;via;to)')
    check(pg.locator('.banner--info button', has_text='Hapus').count() == 1 and pg.locator('.banner--info button', has_text='Tambah').count() == 1, 'the owner can add another or remove')

    pg.locator('.banner--info button', has_text='Hapus').click()
    pg.wait_for_function("document.querySelectorAll('.via-marker').length === 0", timeout=10000)
    check(json.loads(pg.evaluate("JSON.stringify(window.__tree.rooms[window.__roomId].destination)")).get('via') is None, 'removing deletes the stop from the room')
    pg.locator('.banner--danger', has_text='lewat jalan tol').wait_for(timeout=15000)
    check(True, 'without the stop the route is tolled again and the banner returns')

    # a second tap while NOT in pick mode must not add anything
    pg.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.62)
    pg.wait_for_timeout(400)
    check(pg.locator('.via-marker').count() == 0, 'a plain map tap does not add stops')

    # Cancel works
    pg.locator('.banner--danger button', has_text='Atur jalur').click()
    pg.locator('.banner--info button', has_text='Batal').click()
    pg.wait_for_timeout(200)
    check(pg.locator('.banner--info', has_text='Tap peta').count() == 0, '"Batal" leaves pick mode')
    check(not errs, 'no page errors: ' + '; '.join(errs)[:300])
    b.close()
print(f'\n{"FAILED" if fails else "ALL OK"}: {len(fails)} failing')
sys.exit(1 if fails else 0)
