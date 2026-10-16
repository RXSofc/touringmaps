/**
 * 3D map (MapLibre GL). Same public surface as TouringMap in js/map.js, so the
 * touring view can swap one for the other without caring which is active.
 *
 * Differences worth knowing:
 *  - MapLibre uses 512 px tiles, so its zoom is one lower than Leaflet's for the
 *    same view. Everything crossing this class's boundary is in LEAFLET units.
 *  - While following yourself the camera turns to your direction of travel
 *    (heading-up) and sits a little behind you, like a navigation view.
 *  - Needs WebGL and the MapLibre library, which is loaded on demand.
 */
import { MAP_CONFIG } from './map-config.js';
import { buildStyle } from './map-style.js';
import { buildRiderEl, destinationEl, riderSignature, fixOf } from './map.js';
import { APP } from './config.js';
import { MotionTrack } from './motion.js';

const V = MAP_CONFIG.vector;
const toML = (z) => z - 1;
const fromML = (z) => z + 1;
const EMPTY = { type: 'FeatureCollection', features: [] };
const norm360 = (d) => ((d % 360) + 360) % 360;
const angleDiff = (to, from) => ((to - from + 540) % 360) - 180;   // shortest signed turn, -180..180

/* ----------------------------------------------------------- loading */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error(`Could not load ${src}`)); };
    document.head.append(s);
  });
}

function loadCss(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

let loading = null;

/** Loads MapLibre once (vendor copy first, then CDNs). Rejects if none works. */
export function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (!loading) {
    loading = (async () => {
      for (const src of V.library.sources) {
        try {
          await loadScript(src.js);
          if (window.maplibregl) { loadCss(src.css); return window.maplibregl; }
        } catch { /* try the next source */ }
      }
      throw new Error('The 3D map library could not be loaded. Check your connection.');
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** True when this device can create a WebGL context (3D needs it). */
export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

/* ----------------------------------------------------------- helpers */

const lineFeature = (coords) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map((c) => [c[1], c[0]]) } }]
});

/** Polygon approximating a circle of `radius` metres. */
function circleFeature(lat, lng, radius, steps = 48) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

function markerHost(inner, w, h) {
  const el = document.createElement('div');
  el.className = 'ml-marker';
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.append(inner);
  return el;
}

/* ----------------------------------------------------------- the map */

export class TouringMap3D {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers  same as TouringMap
   * @param {{lat:number,lng:number,zoom:number}=} view  starting view (Leaflet zoom units)
   */
  constructor(container, handlers = {}, view) {
    const ml = window.maplibregl;
    if (!ml) throw new Error('MapLibre is not loaded.');
    this.kind = 'maplibre';
    this.handlers = handlers;
    this.riders = new Map();     // uid -> {marker, el, sig, data, track}
    this.data = { route: EMPTY, route2: EMPTY, accuracy: EMPTY };
    this.ready = false;
    this.raf = null;
    this.followUid = null;
    this.bearing = 0;
    this.padded = false;
    this.errors = 0;
    this.gaveUp = false;
    this.destMarker = null;
    this.previewMarker = null;
    this.routeVisible = true;
    this.lastSelf = null;
    this.onVisible = () => { if (!document.hidden) this.kick(); };
    document.addEventListener('visibilitychange', this.onVisible);

    const start = view || { lat: MAP_CONFIG.view.defaultCenter[0], lng: MAP_CONFIG.view.defaultCenter[1], zoom: MAP_CONFIG.view.defaultZoom };
    this.map = new ml.Map({
      container,
      style: buildStyle(),
      center: [start.lng, start.lat],
      zoom: toML(start.zoom),
      pitch: V.pitch,
      maxPitch: V.maxPitch,
      maxZoom: V.maxZoom + 1,
      attributionControl: false,
      fadeDuration: 0,
      renderWorldCopies: true
    });
    this.map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
    this.map.touchZoomRotate.enableRotation();
    requestAnimationFrame(() => { try { this.map.resize(); } catch { /* destroyed meanwhile */ } });   // layout settles after the swap

    this.map.on('load', () => {
      this.ready = true;
      for (const id of Object.keys(this.data)) this.map.getSource(id)?.setData(this.data[id]);
      this._applyRouteVisibility();
    });
    this.map.on('dragstart', (e) => { if (e.originalEvent) handlers.onUserPan?.(); });
    this.map.on('click', (e) => handlers.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    this.map.on('error', (e) => this._onError(e));
    this.map.getCanvas().addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); this._giveUp(); });
  }

  _onError(e) {
    // Only tile/style failures count. A single missing glyph or tile is normal on a bad connection.
    const sourceError = e?.sourceId === 'openmaptiles' || /style|tilejson|openmaptiles/i.test(String(e?.error?.message || ''));
    if (!sourceError) return;
    this.errors += 1;
    if (this.errors >= V.errorsBeforeFallback) this._giveUp();
  }

  _giveUp() {
    if (this.gaveUp) return;
    this.gaveUp = true;
    this.handlers.onTileError?.();
  }

  _setData(id, fc) {
    this.data[id] = fc;
    if (this.ready) this.map.getSource(id)?.setData(fc);
  }

  /* ----------------------------------------------------------- riders */

  syncRiders(riders) {
    const ml = window.maplibregl;
    const seen = new Set();
    for (const r of riders) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      seen.add(r.uid);
      const sig = riderSignature(r);
      const z = r.isSelf ? 1000 : r.selected ? 900 : r.state === 'live' ? 500 : 0;
      let entry = this.riders.get(r.uid);
      if (!entry) {
        const el = markerHost(buildRiderEl(r), 72, 84);
        el.title = r.name;
        el.style.zIndex = String(z);
        el.addEventListener('click', (ev) => { ev.stopPropagation(); this.handlers.onRiderClick?.(r.uid); });
        const marker = new ml.Marker({ element: el, anchor: 'top-left', offset: [-36, -54] }).setLngLat([r.lng, r.lat]).addTo(this.map);
        entry = { marker, el, sig, data: r, track: new MotionTrack(APP.gps.smoothing), lat: r.lat, lng: r.lng };
        entry.track.setFix(fixOf(r));
        this.riders.set(r.uid, entry);
        continue;
      }
      entry.track.setFix(fixOf(r));
      if (entry.sig !== sig) {
        entry.el.replaceChildren(buildRiderEl(r));
        entry.sig = sig;
      }
      entry.el.style.zIndex = String(z);
      entry.data = r;
    }
    for (const [uid, entry] of this.riders) {
      if (!seen.has(uid)) { entry.marker.remove(); this.riders.delete(uid); }
    }
    this.kick();
  }

  setFollow(uid) {
    const next = uid || null;
    if (next === this.followUid) return;
    this.followUid = next;
    if (next) {
      // sit the rider in the lower part of the screen so more road ahead is visible
      const top = Math.round(this.map.getContainer().clientHeight * 0.38);
      this.map.setPadding({ top, bottom: 0, left: 0, right: 0 });
      this.padded = true;
    } else if (this.padded) {
      this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      this.padded = false;
    }
    this.kick();
  }

  kick() {
    if (this.raf || document.hidden || this.gaveUp) return;
    this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = null;
    const now = Date.now();
    let busy = false;
    for (const [uid, e] of this.riders) {
      const s = e.track.sample(now);
      if (Math.abs(e.lat - s.lat) > 1e-9 || Math.abs(e.lng - s.lng) > 1e-9) {
        e.lat = s.lat; e.lng = s.lng;
        e.marker.setLngLat([s.lng, s.lat]);
      }
      if (!s.settled) busy = true;
      if (e.data.isSelf) {
        this.lastSelf = { lat: s.lat, lng: s.lng };
        if (this.data.accuracy.features.length && this._accuracyR) this._setData('accuracy', circleFeature(s.lat, s.lng, this._accuracyR));
      }
      if (uid === this.followUid) {
        // turn toward the direction of travel, only while actually moving
        if (s.heading !== null && s.speed > 1.2) {
          const d = angleDiff(s.heading, this.bearing);
          this.bearing = norm360(this.bearing + d * 0.08);
        }
        this.map.jumpTo({ center: [s.lng, s.lat], bearing: this.bearing });
      }
    }
    if (busy || this.followUid) this.kick();
  }

  /* ----------------------------------------------------------- overlays */

  setAccuracy(fix) {
    if (!fix) { this._accuracyR = 0; this._setData('accuracy', EMPTY); return; }
    this._accuracyR = fix.accuracy;
    const c = this.lastSelf || { lat: fix.latitude, lng: fix.longitude };
    this._setData('accuracy', circleFeature(c.lat, c.lng, fix.accuracy));
  }

  setDestination(dest) {
    if (!dest) { this.destMarker?.remove(); this.destMarker = null; return; }
    const ll = [dest.longitude, dest.latitude];
    if (!this.destMarker) {
      const el = markerHost(destinationEl(false), 64, 76);
      el.title = `Destination: ${dest.name}`;
      el.style.zIndex = '800';
      this.destMarker = new window.maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-14, -62] }).setLngLat(ll).addTo(this.map);
    } else {
      this.destMarker.setLngLat(ll);
      this.destMarker.getElement().title = `Destination: ${dest.name}`;
    }
  }

  previewDestination(point, { pan = true, paddingBottom = 0 } = {}) {
    if (!point) { this.previewMarker?.remove(); this.previewMarker = null; return; }
    const ll = [point.longitude, point.latitude];
    if (!this.previewMarker) {
      const el = markerHost(destinationEl(true), 64, 76);
      el.style.zIndex = '900';
      el.style.pointerEvents = 'none';
      this.previewMarker = new window.maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-14, -62] }).setLngLat(ll).addTo(this.map);
    } else {
      this.previewMarker.setLngLat(ll);
    }
    if (pan) {
      this.map.flyTo({ center: ll, zoom: Math.max(this.map.getZoom(), toML(14)), duration: 600, padding: { top: 0, left: 0, right: 0, bottom: paddingBottom } });
    }
  }

  setRoute(coords) {
    this.routeCoords = coords || null;
    this._setData('route', coords && coords.length > 1 ? lineFeature(coords) : EMPTY);
  }

  setOtherRoute(coords) {
    this._setData('route2', coords && coords.length > 1 ? lineFeature(coords) : EMPTY);
  }

  setRouteVisible(visible) {
    this.routeVisible = visible;
    this._applyRouteVisibility();
  }

  _applyRouteVisibility() {
    if (!this.ready) return;
    const v = this.routeVisible ? 'visible' : 'none';
    for (const id of ['route-casing', 'route-line', 'route2-casing', 'route2-line']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', v);
    }
  }

  /* ----------------------------------------------------------- camera */

  _points(includeDestination) {
    const pts = [...this.riders.values()].map((e) => e.marker.getLngLat());
    if (includeDestination && this.destMarker) pts.push(this.destMarker.getLngLat());
    return pts;
  }

  fitAll({ includeDestination = true, maxZoom = 16 } = {}) {
    const pts = this._points(includeDestination);
    if (!pts.length) return false;
    if (this.padded) { this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); this.padded = false; }
    if (pts.length === 1) {
      this.map.easeTo({ center: pts[0], zoom: toML(Math.min(MAP_CONFIG.view.followZoom, maxZoom)), duration: 600 });
      return true;
    }
    let w = 180; let e = -180; let s = 90; let n = -90;
    for (const p of pts) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
    this.map.fitBounds([[w, s], [e, n]], { padding: { top: 96, bottom: 70, left: 56, right: 76 }, maxZoom: toML(maxZoom), duration: 700 });
    return true;
  }

  panTo(lat, lng, zoom) {
    if (zoom) this.map.flyTo({ center: [lng, lat], zoom: Math.max(this.map.getZoom(), toML(zoom)), duration: 600 });
    else this.map.easeTo({ center: [lng, lat], duration: 400 });
  }

  panToRider(uid) {
    const e = this.riders.get(uid);
    if (!e) return false;
    const ll = e.marker.getLngLat();
    this.panTo(ll.lat, ll.lng, 15);
    return true;
  }

  focusDestination() {
    if (!this.destMarker) return false;
    const ll = this.destMarker.getLngLat();
    this.panTo(ll.lat, ll.lng, 14);
    return true;
  }

  invalidate() { this.map.resize(); }

  getView() { const c = this.map.getCenter(); return { lat: c.lat, lng: c.lng, zoom: fromML(this.map.getZoom()) }; }
  setView(v) { if (v) this.map.jumpTo({ center: [v.lng, v.lat], zoom: toML(v.zoom) }); }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    document.removeEventListener('visibilitychange', this.onVisible);
    for (const e of this.riders.values()) e.marker.remove();
    this.destMarker?.remove();
    this.previewMarker?.remove();
    this.riders.clear();
    try { this.map.remove(); } catch { /* already gone */ }
  }
}
