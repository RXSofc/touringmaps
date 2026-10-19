/**
 * How "my route" looks, shared by the flat map and the 3D map: a muted red that
 * fades to a soft white along the way (start -> destination), on a dark maroon casing.
 * Not a bright red on purpose; the only other red in the app is cancel/back/close.
 */
export const ROUTE_STOPS = Object.freeze([
  [0, '#7A1222'],      // deep red where you are
  [0.55, '#B23A45'],   // muted red
  [1, '#F1D5D5']       // soft white-rose at the destination
]);
export const ROUTE_CASING = '#2A070C';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Colour at position t (0..1) along the route, as '#rrggbb'. */
export function routeColorAt(t) {
  const x = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < ROUTE_STOPS.length; i++) {
    const [t1, c1] = ROUTE_STOPS[i];
    const [t0, c0] = ROUTE_STOPS[i - 1];
    if (x <= t1) {
      const k = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      const a = hex(c0); const b = hex(c1);
      return `#${a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return ROUTE_STOPS[ROUTE_STOPS.length - 1][1];
}
