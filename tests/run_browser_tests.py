"""Starts a static server on :8099, runs the browser tests (Playwright) one by one with a timeout, stops the server.
   python3 tests/run_browser_tests.py            all of them
   python3 tests/run_browser_tests.py overlays   only the ones whose name contains 'overlays'"""
import subprocess, sys, time, os, signal
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = ['map3d_test.py', 'map2d_route_test.py', 'overlays_test.py', 'touring_smoke_test.py', 'banner_layout_test.py', 'nearby_fuel_test.py']
want = sys.argv[1:]
server = subprocess.Popen([sys.executable, '-m', 'http.server', '8099'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
time.sleep(1.2)
bad = 0
try:
    for t in TESTS:
        if want and not any(w in t for w in want): continue
        print(f'=== {t}', flush=True)
        try:
            r = subprocess.run([sys.executable, '-u', f'tests/{t}'], cwd=root, timeout=int(os.environ.get('TEST_TIMEOUT', '120')), capture_output=True, text=True)
            print((r.stdout + r.stderr).strip()[-2500:], flush=True)
            if r.returncode: bad += 1
        except subprocess.TimeoutExpired as e:
            out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or '')
            print('TIMEOUT', out[-1500:], flush=True); bad += 1
finally:
    os.killpg(server.pid, signal.SIGTERM)
print('FAILED:' if bad else 'ALL BROWSER TESTS OK', bad if bad else '')
sys.exit(1 if bad else 0)
