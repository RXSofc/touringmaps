/** Small geodesy helpers. Points are {latitude, longitude}; polylines are [[lat, lng], ...]. */

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

export function isValidLat(n) { return Number.isFinite(n) && n >= -90 && n <= 90; }
export function isValidLng(n) { return Number.isFinite(n) && n >= -180 && n <= 180; }
export function isValidPoint(p) { return !!p && isValidLat(p.latitude) && isValidLng(p.longitude); }

/** Great-circle distance in meters. */
export function haversine(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function roundTo(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function segmentDistance(ax, ay, bx, by) {
  // distance from the origin (0,0) to segment A-B
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Minimum distance in meters from a point to a polyline.
 * Uses a local equirectangular projection, which is accurate enough for
 * off-route checks at the scale of a few hundred meters.
 */
export function distanceToPolyline(point, coords) {
  if (!coords || coords.length === 0) return Infinity;
  const mPerDegLat = (EARTH_RADIUS_M * Math.PI) / 180;
  const mPerDegLng = mPerDegLat * Math.cos(toRad(point.latitude));
  let best = Infinity;
  let prev = null;
  for (const c of coords) {
    const x = (c[1] - point.longitude) * mPerDegLng;
    const y = (c[0] - point.latitude) * mPerDegLat;
    if (prev) best = Math.min(best, segmentDistance(prev.x, prev.y, x, y));
    else best = Math.min(best, Math.hypot(x, y));
    prev = { x, y };
  }
  return best;
}
