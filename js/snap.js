/**
 * Keeps a rider's dot on their own route line.
 *
 * GPS is a few metres off, the route is drawn on the road centre, so the avatar
 * often sits beside the line. When the dot is close to the line we pull it onto
 * it (smoothly: the closer, the stronger), and when it is clearly elsewhere
 * (other road, off route) we leave it alone.
 */
const M_LAT = 111320;
const toRad = (d) => (d * Math.PI) / 180;

/** @param {Array<[number,number]>} coords route as [lat,lng] pairs */
export function makeSnapper(coords) {
  const n = coords?.length || 0;
  let hint = 0;

  function scan(lat, lng, from, to) {
    const mLng = M_LAT * Math.cos(toRad(lat));
    let best = null;
    for (let i = from; i < to; i++) {
      const ax = (coords[i][1] - lng) * mLng; const ay = (coords[i][0] - lat) * M_LAT;
      const bx = (coords[i + 1][1] - lng) * mLng; const by = (coords[i + 1][0] - lat) * M_LAT;
      const dx = bx - ax; const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(Math.max(-(ax * dx + ay * dy) / len2, 0), 1);
      const px = ax + t * dx; const py = ay + t * dy;
      const lateral = Math.hypot(px, py);
      if (!best || lateral < best.lateral) best = { lat: lat + py / M_LAT, lng: lng + px / mLng, lateral, idx: i };
    }
    return best;
  }

  return {
    /** Nearest point on the route: {lat, lng, lateral(m)} or null. */
    nearest(lat, lng) {
      if (n < 2) return null;
      let b = scan(lat, lng, Math.max(0, hint - 30), Math.min(n - 1, hint + 80));   // cheap: look near the last match first
      if (!b || b.lateral > 25) b = scan(lat, lng, 0, n - 1);                        // lost it: full search
      hint = b.idx;
      return b;
    },
    /**
     * Compass bearing of the road ahead: from the nearest point on the route to the point
     * `distM` metres further along it. Null when off the route or at its very end.
     */
    aheadBearing(lat, lng, distM = 120) {
      const near = this.nearest(lat, lng);
      if (!near || near.lateral > 60) return null;
      const mLng = M_LAT * Math.cos(toRad(lat));
      let px = near.lng; let py = near.lat; let acc = 0;
      for (let i = near.idx + 1; i < n; i++) {
        const cx = coords[i][1]; const cy = coords[i][0];
        const seg = Math.hypot((cx - px) * mLng, (cy - py) * M_LAT);
        if (acc + seg >= distM) {
          const t = seg > 0 ? (distM - acc) / seg : 0;
          px += (cx - px) * t; py += (cy - py) * t; acc = distM;
          break;
        }
        acc += seg; px = cx; py = cy;
      }
      if (acc < 8) return null;
      const dx = (px - near.lng) * mLng; const dy = (py - near.lat) * M_LAT;
      return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    },
    /**
     * The position to draw. Within 40% of the snap distance the dot sits exactly on
     * the line; farther out the pull fades smoothly to nothing at the snap distance.
     * @param {{lat:number,lng:number}} pos
     * @param {number} accuracy GPS accuracy in metres (bigger = trust the line more)
     */
    apply(pos, accuracy) {
      const near = this.nearest(pos.lat, pos.lng);
      if (!near) return pos;
      const reach = Math.min(Math.max((Number.isFinite(accuracy) ? accuracy : 10) * 1.5, 12), 30);
      if (near.lateral >= reach) return pos;
      // smoothstep: full pull close to the line, no pull at `reach`, and no pop in between
      const a = reach * 0.4;
      const u = Math.min(Math.max((near.lateral - a) / (reach - a), 0), 1);
      const w = 1 - u * u * (3 - 2 * u);
      return { lat: pos.lat + (near.lat - pos.lat) * w, lng: pos.lng + (near.lng - pos.lng) * w };
    }
  };
}
