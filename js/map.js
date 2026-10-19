/**
 * Leaflet wrapper. Markers are created once and updated in place; the DOM of a
 * marker is only rebuilt when something visible about that rider changed.
 */
import { MAP_CONFIG, usableProviders } from './map-config.js';
import { h, formatAge, defaultAvatar } from './ui.js';
import { APP } from './config.js';
import { MotionTrack } from './motion.js';
import { makeSnapper } from './snap.js';
import { buildPath } from './guidance.js';
import { routeColorAt, ROUTE_CASING } from './route-style.js';

const L = window.L;

/** What the motion track needs from a rider record. */
export function fixOf(r) {
  const f = r.fix || {};
  return { lat: r.lat, lng: r.lng, speed: f.speed, heading: f.heading, accuracy: f.accuracy, measuredAt: Number.isFinite(f.measuredAt) ? f.measuredAt : Date.now() };
}

export function riderSignature(r) {
  return [r.name, r.avatar, r.state, r.isSelf, r.selected, r.talking, r.state === 'live' ? '' : formatAge(r.ageMs)].join('|');
}

export function buildRiderEl(r) {
  const fallback = defaultAvatar(r.name, r.uid);
  const img = h('img', { class: 'rider-marker__avatar', alt: '', width: 46, height: 46, referrerpolicy: 'no-referrer', decoding: 'async' });
  img.addEventListener('error', () => { if (img.src !== fallback) img.src = fallback; }, { once: true });
  img.src = r.avatar || fallback;

  const showAge = r.state !== 'live' && r.state !== 'nolocation' && Number.isFinite(r.ageMs);
  const cls = ['rider-marker', `is-${r.state}`, r.isSelf ? 'is-self' : '', r.selected ? 'is-selected' : '', r.talking ? 'is-talking' : ''].filter(Boolean).join(' ');
  return h('div', { class: cls },
    h('div', { class: 'rider-marker__avatar-wrap' }, img, h('span', { class: 'rider-marker__status' })),
    h('div', { class: 'rider-marker__pointer' }),
    h('div', { class: 'rider-marker__label' }, r.isSelf ? `${r.name} (you)` : r.name),
    showAge ? h('div', { class: 'rider-marker__age' }, `${r.state === 'offline' ? 'OFFLINE ' : ''}${formatAge(r.ageMs)}`) : null
  );
}

export function destinationEl(preview) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M14 58V6" stroke="#141616" stroke-width="6" fill="none"/>' +
    '<path d="M17 8h38l-8 12 8 12H17z" fill="#7F1D1A" stroke="#141616" stroke-width="4" stroke-linejoin="miter"/>' +
    '<path d="M24 10h8v8h-8zM40 10h8v8h-8zM32 18h8v8h-8zM24 26h8v4h-8zM40 26h6v4h-6z" fill="#E6E3E1"/>';
  return h('div', { class: `dest-marker${preview ? ' is-preview' : ''}` }, svg,
    h('div', { class: 'dest-marker__label' }, preview ? 'PREVIEW' : 'DEST'));
}

export class TouringMap {
  /**
   * @param {HTMLElement} container
   * @param {{onRiderClick?:(uid:string)=>void, onMapClick?:(latlng:{lat:number,lng:number})=>void,
   *          onUserPan?:()=>void, onTileError?:()=>void}} handlers
   */
  constructor(container, handlers = {}) {
    if (!L) throw new Error('Leaflet is not loaded.');
    this.kind = 'leaflet';
    this.handlers = handlers;
    this.riders = new Map();       // uid -> {marker, sig, data, track}
    this.raf = null;
    this.followUid = null;
    this.onVisible = () => { if (!document.hidden) this.kick(); };
    document.addEventListener('visibilitychange', this.onVisible);
    this.tileErrors = 0;

    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      center: MAP_CONFIG.view.defaultCenter,
      zoom: MAP_CONFIG.view.defaultZoom,
      worldCopyJump: true,
      tap: true
    });
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);

    // Tiles: first usable provider from map-config; if its tiles keep failing, move to the next one.
    this.tileProviders = usableProviders('tiles');
    this.tileIndex = -1;
    this.tileLayer = null;
    if (!this.nextTileProvider()) handlers.onTileError?.();

    this.accuracyCircle = null;
    this.destMarker = null;
    this.previewMarker = null;
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.otherRouteLayer = L.layerGroup().addTo(this.map);
    this.routeVisible = true;
    this.routeDim = false;
    this.routeCoords = null;
    this.snapper = null;

    this.map.on('dragstart', () => handlers.onUserPan?.());
    this.map.on('click', (e) => handlers.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
  }

  /** Switches to the next usable tile provider. @returns {boolean} false when none is left. */
  nextTileProvider() {
    const p = this.tileProviders[this.tileIndex + 1];
    if (!p) return false;
    this.tileIndex += 1;
    this.tileErrors = 0;
    this.tileLayer?.remove();
    this.activeTiles = p;
    this.tileLayer = L.tileLayer(p.url, {
      maxZoom: p.maxZoom,
      subdomains: p.subdomains || 'abc',
      attribution: p.attribution,       // always visible: the attribution control is never removed
      apiKey: p.apiKey,                 // fills {apiKey} for keyed providers
      crossOrigin: true
    }).addTo(this.map);
    this.tileLayer.on('tileerror', () => {
      this.tileErrors += 1;
      if (this.tileErrors === MAP_CONFIG.tiles.errorsBeforeFallback && !this.nextTileProvider()) this.handlers.onTileError?.();
    });
    this.tileLayer.on('load', () => { this.tileErrors = 0; });
    return true;
  }

  /** @param {Array<{uid,name,avatar,state,lat,lng,ageMs,isSelf,selected}>} riders */
  syncRiders(riders) {
    const seen = new Set();
    for (const r of riders) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      seen.add(r.uid);
      const sig = riderSignature(r);
      const zIndexOffset = r.isSelf ? 1000 : r.selected ? 900 : r.state === 'live' ? 500 : 0;
      let entry = this.riders.get(r.uid);
      if (!entry) {
        const marker = L.marker([r.lat, r.lng], {
          icon: L.divIcon({ className: 'rider-icon', html: buildRiderEl(r), iconSize: [72, 84], iconAnchor: [36, 54] }),
          title: r.name,
          alt: `${r.name}${r.isSelf ? ' (you)' : ''}`,
          keyboard: true,
          zIndexOffset
        }).addTo(this.map);
        marker.on('click', () => this.handlers.onRiderClick?.(r.uid));
        entry = { marker, sig, data: r, track: new MotionTrack(APP.gps.smoothing) };
        entry.track.setFix(fixOf(r));
        this.riders.set(r.uid, entry);
        continue;
      }
      entry.track.setFix(fixOf(r));   // the marker glides there in the animation loop
      if (entry.sig !== sig) {
        entry.marker.setIcon(L.divIcon({ className: 'rider-icon', html: buildRiderEl(r), iconSize: [72, 84], iconAnchor: [36, 54] }));
        entry.sig = sig;
      }
      entry.marker.setZIndexOffset(zIndexOffset);
      entry.data = r;
    }
    for (const [uid, entry] of this.riders) {
      if (!seen.has(uid)) { entry.marker.remove(); this.riders.delete(uid); }
    }
    this.kick();
  }

  /** Keep the map centred on one rider (smoothly, every frame), or stop with null. */
  setFollow(uid) {
    this.followUid = uid || null;
    this.kick();
  }

  kick() {
    if (this.raf || document.hidden) return;
    this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = null;
    const now = Date.now();
    let busy = false;
    for (const [uid, e] of this.riders) {
      let s = e.track.sample(now);
      // my own dot rides on my route line instead of beside it
      if (e.data.isSelf && this.snapper && this.routeVisible) s = { ...s, ...this.snapper.apply(s, e.data.fix?.accuracy) };
      const cur = e.marker.getLatLng();
      if (Math.abs(cur.lat - s.lat) > 1e-9 || Math.abs(cur.lng - s.lng) > 1e-9) e.marker.setLatLng([s.lat, s.lng]);
      if (!s.settled) busy = true;
      if (e.data.isSelf && this.accuracyCircle) this.accuracyCircle.setLatLng([s.lat, s.lng]);
      if (uid === this.followUid) {
        const p = this.map.latLngToContainerPoint([s.lat, s.lng]);
        const size = this.map.getSize();
        const dx = p.x - size.x / 2; const dy = p.y - size.y / 2;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) this.map.panBy([dx, dy], { animate: false });
      }
    }
    if (busy || this.followUid) this.kick();
  }

  setAccuracy(fix) {
    if (!fix) { this.accuracyCircle?.remove(); this.accuracyCircle = null; return; }
    const ll = [fix.latitude, fix.longitude];
    if (!this.accuracyCircle) {
      this.accuracyCircle = L.circle(ll, {
        radius: fix.accuracy, color: '#141616', weight: 1.5, dashArray: '4 4',
        fillColor: '#141616', fillOpacity: 0.08, interactive: false
      }).addTo(this.map);
    } else {
      if (![...this.riders.values()].some((e) => e.data.isSelf)) this.accuracyCircle.setLatLng(ll); // otherwise the animation loop moves it
      this.accuracyCircle.setRadius(fix.accuracy);
    }
  }

  setDestination(dest) {
    if (!dest) { this.destMarker?.remove(); this.destMarker = null; return; }
    const ll = [dest.latitude, dest.longitude];
    if (!this.destMarker) {
      this.destMarker = L.marker(ll, {
        icon: L.divIcon({ className: 'dest-icon', html: destinationEl(false), iconSize: [64, 76], iconAnchor: [14, 62] }),
        title: `Destination: ${dest.name}`, alt: `Destination: ${dest.name}`, zIndexOffset: 800, keyboard: true
      }).addTo(this.map);
    } else {
      this.destMarker.setLatLng(ll);
      this.destMarker.options.title = `Destination: ${dest.name}`;
    }
  }

  /** Temporary marker while the user is choosing a destination. */
  previewDestination(point, { pan = true, paddingBottom = 0 } = {}) {
    if (!point) { this.previewMarker?.remove(); this.previewMarker = null; return; }
    const ll = [point.latitude, point.longitude];
    if (!this.previewMarker) {
      this.previewMarker = L.marker(ll, {
        icon: L.divIcon({ className: 'dest-icon', html: destinationEl(true), iconSize: [64, 76], iconAnchor: [14, 62] }),
        zIndexOffset: 900, interactive: false
      }).addTo(this.map);
    } else {
      this.previewMarker.setLatLng(ll);
    }
    if (pan) {
      const zoom = Math.max(this.map.getZoom(), 14);
      this.map.flyTo(ll, zoom, { duration: 0.6, paddingBottomRight: [0, paddingBottom] });
      if (paddingBottom) {
        this.map.once('moveend', () => this.map.panBy([0, paddingBottom / 2], { animate: true }));
      }
    }
  }

  setRoute(coords) {
    this.routeLayer.clearLayers();
    this.routeCoords = coords || null;
    this.snapper = coords && coords.length > 1 ? makeSnapper(coords) : null;
    if (!coords || coords.length < 2) return;
    // dark casing under a muted-red line that fades to soft white toward the destination
    L.polyline(coords, { color: ROUTE_CASING, weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false, className: 'route-casing' }).addTo(this.routeLayer);
    const path = buildPath(coords);
    const parts = Math.max(1, Math.min(32, Math.round(path.total / 120)));   // about one colour step per 120 m
    let from = 0;
    for (let k = 1; k <= parts; k++) {
      const target = (path.total * k) / parts;
      let to = from;
      while (to < coords.length - 1 && path.cum[to] < target) to++;
      if (k === parts) to = coords.length - 1;
      if (to > from) {
        L.polyline(coords.slice(from, to + 1), { color: routeColorAt((k - 0.5) / parts), weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(this.routeLayer);
        from = to;
      }
    }
    this._applyRouteDim();
    this._applyRouteVisibility();
  }

  /** Faded line = "this route is out of date / not usable" (re-routing, or it touches a toll road). */
  setRouteDim(dim) {
    this.routeDim = !!dim;
    this._applyRouteDim();
  }

  _applyRouteDim() {
    const o = this.routeDim ? 0.28 : 1;
    this.routeLayer.eachLayer((l) => l.setStyle?.({ opacity: o }));
  }

  setOtherRoute(coords) {
    this.otherRouteLayer.clearLayers();
    if (!coords) return;
    L.polyline(coords, { color: '#141616', weight: 8, opacity: 1, interactive: false }).addTo(this.otherRouteLayer);
    L.polyline(coords, { color: '#FFFFFF', weight: 4, dashArray: '10 8', interactive: false }).addTo(this.otherRouteLayer);
  }

  setRouteVisible(visible) {
    this.routeVisible = visible;
    this._applyRouteVisibility();
  }

  _applyRouteVisibility() {
    for (const layer of [this.routeLayer, this.otherRouteLayer]) {
      if (this.routeVisible) layer.addTo(this.map); else layer.remove();
    }
  }

  fitAll({ includeDestination = true, padding = [56, 56], maxZoom = 16 } = {}) {
    const pts = [...this.riders.values()].map((e) => e.marker.getLatLng());
    if (includeDestination && this.destMarker) pts.push(this.destMarker.getLatLng());
    if (!pts.length) return false;
    if (pts.length === 1) { this.map.setView(pts[0], Math.min(MAP_CONFIG.view.followZoom, maxZoom), { animate: true }); return true; }
    this.map.fitBounds(L.latLngBounds(pts), { padding, maxZoom, animate: true });
    return true;
  }

  panTo(lat, lng, zoom) {
    const target = [lat, lng];
    if (zoom) this.map.flyTo(target, Math.max(this.map.getZoom(), zoom), { duration: 0.5 });
    else this.map.panTo(target, { animate: true, duration: 0.4 });
  }

  panToRider(uid) {
    const e = this.riders.get(uid);
    if (!e) return false;
    const ll = e.marker.getLatLng();
    this.panTo(ll.lat, ll.lng, 15);
    return true;
  }

  focusDestination() {
    if (!this.destMarker) return false;
    const ll = this.destMarker.getLatLng();
    this.panTo(ll.lat, ll.lng, 14);
    return true;
  }

  invalidate() { this.map.invalidateSize({ animate: false }); }

  /** Relief only exists on the 3D map. */
  setTerrain() { return false; }

  /** Where the camera is, in Leaflet zoom units (shared with the 3D map so a switch keeps the view). */
  getView() { const c = this.map.getCenter(); return { lat: c.lat, lng: c.lng, zoom: this.map.getZoom() }; }
  setView(v) { if (v) this.map.setView([v.lat, v.lng], v.zoom, { animate: false }); }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.map.off();
    this.map.remove();
    this.riders.clear();
  }
}
