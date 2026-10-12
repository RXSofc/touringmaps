/**
 * Leaflet wrapper. Markers are created once and updated in place; the DOM of a
 * marker is only rebuilt when something visible about that rider changed.
 */
import { APP } from './config.js';
import { h, formatAge, defaultAvatar } from './ui.js';

const L = window.L;

function riderSignature(r) {
  return [r.name, r.avatar, r.state, r.isSelf, r.selected, r.state === 'live' ? '' : formatAge(r.ageMs)].join('|');
}

function buildRiderEl(r) {
  const fallback = defaultAvatar(r.name, r.uid);
  const img = h('img', { class: 'rider-marker__avatar', alt: '', width: 46, height: 46, referrerpolicy: 'no-referrer', decoding: 'async' });
  img.addEventListener('error', () => { if (img.src !== fallback) img.src = fallback; }, { once: true });
  img.src = r.avatar || fallback;

  const showAge = r.state !== 'live' && r.state !== 'nolocation' && Number.isFinite(r.ageMs);
  const cls = ['rider-marker', `is-${r.state}`, r.isSelf ? 'is-self' : '', r.selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  return h('div', { class: cls },
    h('div', { class: 'rider-marker__avatar-wrap' }, img, h('span', { class: 'rider-marker__status' })),
    h('div', { class: 'rider-marker__pointer' }),
    h('div', { class: 'rider-marker__label' }, r.isSelf ? `${r.name} (you)` : r.name),
    showAge ? h('div', { class: 'rider-marker__age' }, `${r.state === 'offline' ? 'OFFLINE ' : ''}${formatAge(r.ageMs)}`) : null
  );
}

function destinationEl(preview) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M14 58V6" stroke="#171717" stroke-width="6" fill="none"/>' +
    '<path d="M17 8h38l-8 12 8 12H17z" fill="#FF765E" stroke="#171717" stroke-width="4" stroke-linejoin="miter"/>' +
    '<path d="M24 10h8v8h-8zM40 10h8v8h-8zM32 18h8v8h-8zM24 26h8v4h-8zM40 26h6v4h-6z" fill="#171717"/>';
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
    this.handlers = handlers;
    this.riders = new Map();       // uid -> {marker, sig, data}
    this.tileErrors = 0;

    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      center: APP.map.defaultCenter,
      zoom: APP.map.defaultZoom,
      worldCopyJump: true,
      tap: true
    });
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);

    const tiles = L.tileLayer(APP.map.tileUrl, {
      maxZoom: APP.map.tileMaxZoom,
      attribution: APP.map.tileAttribution,
      crossOrigin: true
    }).addTo(this.map);
    tiles.on('tileerror', () => {
      this.tileErrors += 1;
      if (this.tileErrors === 3) handlers.onTileError?.();
    });
    tiles.on('load', () => { this.tileErrors = 0; });

    this.accuracyCircle = null;
    this.destMarker = null;
    this.previewMarker = null;
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.otherRouteLayer = L.layerGroup().addTo(this.map);
    this.routeVisible = true;
    this.routeCoords = null;

    this.map.on('dragstart', () => handlers.onUserPan?.());
    this.map.on('click', (e) => handlers.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
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
        entry = { marker, sig, data: r };
        this.riders.set(r.uid, entry);
        continue;
      }
      const ll = entry.marker.getLatLng();
      if (ll.lat !== r.lat || ll.lng !== r.lng) entry.marker.setLatLng([r.lat, r.lng]);
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
  }

  setAccuracy(fix) {
    if (!fix) { this.accuracyCircle?.remove(); this.accuracyCircle = null; return; }
    const ll = [fix.latitude, fix.longitude];
    if (!this.accuracyCircle) {
      this.accuracyCircle = L.circle(ll, {
        radius: fix.accuracy, color: '#171717', weight: 1.5, dashArray: '4 4',
        fillColor: '#79B8FF', fillOpacity: 0.18, interactive: false
      }).addTo(this.map);
    } else {
      this.accuracyCircle.setLatLng(ll).setRadius(fix.accuracy);
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
    if (!coords) return;
    // dark casing under a bright line keeps the route readable on any basemap
    L.polyline(coords, { color: '#171717', weight: 10, opacity: 0.95, lineCap: 'butt', lineJoin: 'miter', interactive: false, className: 'route-casing' }).addTo(this.routeLayer);
    L.polyline(coords, { color: '#C7F36B', weight: 5, opacity: 1, lineCap: 'butt', lineJoin: 'miter', interactive: false }).addTo(this.routeLayer);
    this._applyRouteVisibility();
  }

  setOtherRoute(coords) {
    this.otherRouteLayer.clearLayers();
    if (!coords) return;
    L.polyline(coords, { color: '#171717', weight: 8, opacity: 0.9, interactive: false }).addTo(this.otherRouteLayer);
    L.polyline(coords, { color: '#79B8FF', weight: 4, dashArray: '10 8', interactive: false }).addTo(this.otherRouteLayer);
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
    if (pts.length === 1) { this.map.setView(pts[0], Math.min(APP.map.followZoom, maxZoom), { animate: true }); return true; }
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

  destroy() {
    this.map.off();
    this.map.remove();
    this.riders.clear();
  }
}
