/**
 * The optional live-traffic layer (TomTom raster flow tiles). Pure helpers: is it available, the tile URL, and a
 * health watch that switches the layer off when every tile fails (free daily tile allowance used up, or a wrong key).
 * The maps draw it (setTrafficLayer in map.js / map3d.js); the touring screen decides when.
 */
import { MAP_CONFIG } from './map-config.js';

/** True only with a real key and a base URL. Out of the box it is false, and the app behaves as it always did. */
export function trafficAvailable(cfg = MAP_CONFIG.traffic) {
  if (!cfg || typeof cfg.baseUrl !== 'string' || !cfg.baseUrl) return false;
  const key = typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '';
  return key.length > 0 && !/YOUR_/i.test(key);
}

/**
 * What a map needs to draw the layer, or null when it is not available.
 * `url` keeps the {z}/{x}/{y} placeholders: Leaflet and MapLibre fill them in.
 */
export function trafficLayerOptions({ cfg = MAP_CONFIG.traffic, neon = false, onOk, onFail } = {}) {
  if (!trafficAvailable(cfg)) return null;
  const style = neon ? cfg.darkStyle : cfg.style;
  return {
    url: `${cfg.baseUrl}/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(cfg.apiKey.trim())}&tileSize=${cfg.tileSize}`,
    tileSize: cfg.tileSize,
    minZoom: cfg.minZoom,
    opacity: cfg.opacity,
    attribution: cfg.attribution,
    onOk,
    onFail
  };
}

/**
 * Counts tile loads and failures. A phone screen needs only about 4 tiles of 512 px, so by default 4 failed tiles and not one ever loaded, the key is refused or the
 * allowance is gone: `onTrip` fires once. A single loaded tile proves the key works, so scattered failures never trip it.
 */
export class TrafficHealth {
  constructor({ maxFails = 4, onTrip } = {}) { this.maxFails = maxFails; this.onTrip = onTrip; this.reset(); }
  reset() { this.oks = 0; this.fails = 0; this.tripped = false; }
  ok() { this.oks += 1; }
  fail() {
    this.fails += 1;
    if (!this.tripped && this.oks === 0 && this.fails >= this.maxFails) { this.tripped = true; this.onTrip?.(); }
  }
}
