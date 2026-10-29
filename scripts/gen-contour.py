"""Generates the seamless topographic tiles used by the 'Kontur' backdrop.
Two layers from one periodic height field: thin contour lines, and thick index lines with
elevation labels and peak markers. Run: python3 scripts/gen-contour.py"""
import numpy as np, random, math
from skimage import measure
from scipy.ndimage import maximum_filter

S = 960; N = 240; random.seed(7)
comps = []
for _ in range(9):
    kx, ky = random.randint(-3, 3), random.randint(-3, 3)
    if kx == 0 and ky == 0: continue
    comps.append((kx, ky, random.random() * 2 * math.pi, 1 / math.hypot(kx, ky) ** 0.8))
xs = np.linspace(0, 1, N + 1); X, Y = np.meshgrid(xs, xs)
Z = sum(a * np.cos(2 * math.pi * (kx * X + ky * Y) + ph) for kx, ky, ph, a in comps)
Z = (Z - Z.min()) / (Z.max() - Z.min())
STEP = 0.034; INDEX_EVERY = 5

def path(c, close_tol=0.5):
    pts = [(p[1] / N * S, p[0] / N * S) for p in c]
    d = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts[::3] + [pts[-1]])
    return d

def levels():
    k = 1
    while k * STEP < 1:
        yield k, k * STEP; k += 1

thin, idx, labels = [], [], []
for k, lv in levels():
    for c in measure.find_contours(Z, lv):
        if len(c) < 8: continue
        (idx if k % INDEX_EVERY == 0 else thin).append(path(c))
        if k % INDEX_EVERY == 0 and len(c) > 70:
            p = c[len(c) // 2]; x, y = p[1] / N * S, p[0] / N * S
            if 40 < x < S - 60 and 40 < y < S - 40: labels.append((x, y, int(300 + lv * 2400)))

# peaks: local maxima of the field
mx = (Z == maximum_filter(Z, size=41)) & (Z > 0.72)
peaks = [(j / N * S, i / N * S, int(300 + Z[i, j] * 2400)) for i, j in zip(*np.nonzero(mx)) if 30 < j / N * S < S - 30 and 30 < i / N * S < S - 30]

head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}" fill="none" stroke-linejoin="round">'
open('assets/images/contour-lines.svg', 'w').write(head + f'<path d="{" ".join(thin)}" stroke="#3D3C38" stroke-width="2.5"/></svg>')
t = ''.join(f'<text x="{x:.0f}" y="{y:.0f}" text-anchor="middle" dominant-baseline="central">{m}</text>' for x, y, m in labels)
pk = ''.join(f'<path d="M{x-11:.0f},{y+8:.0f} L{x:.0f},{y-11:.0f} L{x+11:.0f},{y+8:.0f} Z" fill="#A49F9D" stroke="#141616" stroke-width="3"/><text x="{x+16:.0f}" y="{y+4:.0f}" fill="#E6E3E1" stroke="#141616" stroke-width="5" paint-order="stroke" font-size="15">{m} m</text>' for x, y, m in peaks)
open('assets/images/contour-index.svg', 'w').write(head + f'<path d="{" ".join(idx)}" stroke="#746D67" stroke-width="4.5"/><g font-family="Space Grotesk,Arial,sans-serif" font-weight="700" font-size="14" fill="#A49F9D" stroke="#141616" stroke-width="7" paint-order="stroke" stroke-linejoin="round">{t}</g><g font-family="Space Grotesk,Arial,sans-serif" font-weight="700">{pk}</g></svg>')
print(len(thin), len(idx), len(labels), len(peaks))
