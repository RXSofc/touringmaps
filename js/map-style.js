/**
 * Black-and-white MapLibre style for 3D mode (OpenMapTiles schema).
 *
 * Built in code so the palette stays in this app (grayscale only) and so the
 * route / accuracy overlays live in the style from the start: they are plain
 * GeoJSON sources that the map updates with setData().
 */
import { MAP_CONFIG } from './map-config.js';
import { ROUTE_STOPS, ROUTE_CASING } from './route-style.js';

const V = MAP_CONFIG.vector;
const EMPTY = { type: 'FeatureCollection', features: [] };
const zoomWidth = (...pairs) => ['interpolate', ['exponential', 1.4], ['zoom'], ...pairs];
const inClass = (list) => ['match', ['get', 'class'], list, true, false];

/** Road groups, widest first; widths are [z, px, z, px, ...]. */
const ROADS = [
  { id: 'minor', classes: ['minor', 'service', 'track', 'busway', 'raceway'], fill: '#FFFFFF', width: [11, 0.4, 14, 2, 18, 9], casing: [11, 1, 14, 3.4, 18, 12] },
  { id: 'tertiary', classes: ['tertiary'], fill: '#FFFFFF', width: [10, 0.6, 14, 3, 18, 13], casing: [10, 1.4, 14, 4.6, 18, 16] },
  { id: 'secondary', classes: ['secondary'], fill: '#FFFFFF', width: [9, 0.8, 14, 3.6, 18, 15], casing: [9, 1.6, 14, 5.4, 18, 18] },
  { id: 'primary', classes: ['primary'], fill: '#FFFFFF', width: [8, 1, 14, 4.4, 18, 17], casing: [8, 1.8, 14, 6.4, 18, 20] },
  // toll-prone roads read differently (gray fill) so a rider notices them
  { id: 'motorway', classes: ['motorway', 'trunk'], fill: '#9A9A9A', width: [6, 1, 14, 4.6, 18, 18], casing: [6, 2, 14, 6.6, 18, 21] }
];

export function buildStyle() {
  const layers = [];
  const add = (l) => layers.push(l);
  const src = 'openmaptiles';

  add({ id: 'background', type: 'background', paint: { 'background-color': '#F1F1F1' } });
  add({
    id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover',
    paint: { 'fill-color': ['match', ['get', 'class'], ['wood', 'grass', 'farmland'], '#E4E4E4', '#EAEAEA'], 'fill-opacity': 0.9 }
  });
  add({
    id: 'landuse', type: 'fill', source: src, 'source-layer': 'landuse',
    paint: { 'fill-color': ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], '#EBEBEB', ['cemetery', 'hospital', 'school', 'college', 'stadium', 'pitch'], '#E0E0E0', '#EEEEEE'] }
  });
  add({ id: 'park', type: 'fill', source: src, 'source-layer': 'park', paint: { 'fill-color': '#DEDEDE', 'fill-opacity': 0.8 } });
  add({ id: 'water', type: 'fill', source: src, 'source-layer': 'water', paint: { 'fill-color': '#BEBEBE' } });
  add({
    id: 'waterway', type: 'line', source: src, 'source-layer': 'waterway', minzoom: 8,
    paint: { 'line-color': '#BEBEBE', 'line-width': zoomWidth(8, 0.5, 16, 3) }
  });

  // relief shading, only visible while the HILL button is on (the map toggles this layer)
  add({
    id: 'hillshade', type: 'hillshade', source: 'terrain', layout: { visibility: 'none' },
    paint: {
      'hillshade-exaggeration': 0.55,
      'hillshade-shadow-color': '#6B6B6B',
      'hillshade-highlight-color': '#FFFFFF',
      'hillshade-accent-color': '#A8A8A8',
      'hillshade-illumination-direction': 335
    }
  });

  // flat footprints first (cheap when zoomed out), extrusions take over close up
  add({
    id: 'building-flat', type: 'fill', source: src, 'source-layer': 'building', minzoom: 13, maxzoom: V.buildingsMinZoom,
    paint: { 'fill-color': '#D9D9D9', 'fill-outline-color': '#B5B5B5' }
  });

  add({
    id: 'rail', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 11,
    filter: ['==', ['get', 'class'], 'rail'],
    paint: { 'line-color': '#8C8C8C', 'line-width': zoomWidth(11, 0.6, 18, 2), 'line-dasharray': [3, 3] }
  });
  add({
    id: 'path', type: 'line', source: src, 'source-layer': 'transportation', minzoom: 14,
    filter: inClass(['path', 'pedestrian']),
    paint: { 'line-color': '#9C9C9C', 'line-width': zoomWidth(14, 0.6, 18, 2), 'line-dasharray': [2, 2] }
  });

  const tunnelOff = ['!=', ['get', 'brunnel'], 'tunnel'];
  for (const g of ROADS) {
    add({
      id: `road-casing-${g.id}`, type: 'line', source: src, 'source-layer': 'transportation', minzoom: g.casing[0],
      filter: ['all', tunnelOff, inClass(g.classes)],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#141616', 'line-width': zoomWidth(...g.casing) }
    });
  }
  for (const g of ROADS) {
    add({
      id: `road-${g.id}`, type: 'line', source: src, 'source-layer': 'transportation', minzoom: g.width[0],
      filter: ['all', tunnelOff, inClass(g.classes)],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': g.fill, 'line-width': zoomWidth(...g.width) }
    });
  }

  // crisp footprint edges between buildings (they read as street-level detail when tilted)
  add({
    id: 'building-outline', type: 'line', source: src, 'source-layer': 'building', minzoom: 15,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: { 'line-color': '#6E6E6E', 'line-width': zoomWidth(15, 0.5, 19, 1.4), 'line-opacity': 0.9 }
  });

  // Extrusions. Taller buildings get a darker tone so a skyline has depth even in pure grayscale;
  // `hide_3d` skips outlines whose parts are drawn separately (avoids doubled, flickering walls).
  const height = ['coalesce', ['get', 'render_height'], 5];
  add({
    id: 'building-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: V.buildingsMinZoom,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], height, 0, '#FFFFFF', 12, '#F0F0F0', 30, '#D9D9D9', 80, '#BDBDBD', 200, '#9A9A9A'],
      'fill-extrusion-height': height,
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.96,
      'fill-extrusion-vertical-gradient': true
    }
  });

  // points of interest: a dot plus the name (text needs the glyph server; the dots do not)
  add({
    id: 'poi-dot', type: 'circle', source: src, 'source-layer': 'poi', minzoom: 15.5,
    filter: ['has', 'name'],
    paint: { 'circle-radius': zoomWidth(15.5, 2.5, 19, 5), 'circle-color': '#141616', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.5 }
  });

  // overlays sit above the roads and buildings so the route is never hidden
  add({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#141616', 'fill-opacity': 0.08 } });
  add({ id: 'accuracy-line', type: 'line', source: 'accuracy', paint: { 'line-color': '#141616', 'line-width': 1.5, 'line-dasharray': [3, 3] } });
  add({ id: 'route2-casing', type: 'line', source: 'route2', layout: { 'line-join': 'round' }, paint: { 'line-color': '#141616', 'line-width': zoomWidth(8, 4, 18, 14) } });
  add({ id: 'route2-line', type: 'line', source: 'route2', layout: { 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': zoomWidth(8, 1.6, 18, 6), 'line-dasharray': [2, 1.5] } });
  add({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ROUTE_CASING, 'line-width': zoomWidth(8, 5, 18, 20) } });
  add({
    id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
    // muted red fading to soft white along the route (needs lineMetrics on the source)
    paint: { 'line-gradient': ['interpolate', ['linear'], ['line-progress'], ...ROUTE_STOPS.flat()], 'line-width': zoomWidth(8, 2.4, 18, 10) }
  });

  const font = [V.fontstack];
  const name = ['coalesce', ['get', 'name:latin'], ['get', 'name']];
  add({
    id: 'road-label', type: 'symbol', source: src, 'source-layer': 'transportation_name', minzoom: 13,
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': font, 'text-size': zoomWidth(13, 10, 18, 14), 'text-letter-spacing': 0.04 },
    paint: { 'text-color': '#141616', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 }
  });
  add({
    id: 'place-label', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 5,
    filter: inClass(['city', 'town', 'village', 'suburb', 'neighbourhood', 'hamlet']),
    layout: {
      'text-field': name, 'text-font': font, 'text-max-width': 8,
      'text-size': ['match', ['get', 'class'], 'city', 16, 'town', 14, 'village', 12.5, 11],
      'text-transform': 'uppercase', 'text-letter-spacing': 0.06
    },
    paint: { 'text-color': '#141616', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2.2 }
  });

  add({
    id: 'poi-label', type: 'symbol', source: src, 'source-layer': 'poi', minzoom: 16,
    filter: ['has', 'name'],
    layout: { 'text-field': name, 'text-font': font, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 7, 'text-optional': true },
    paint: { 'text-color': '#141616', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 }
  });
  add({
    id: 'housenumber', type: 'symbol', source: src, 'source-layer': 'housenumber', minzoom: 17.5,
    layout: { 'text-field': ['get', 'housenumber'], 'text-font': font, 'text-size': 10, 'text-optional': true },
    paint: { 'text-color': '#4D4D4D', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }
  });
  add({
    id: 'water-label', type: 'symbol', source: src, 'source-layer': 'water_name', minzoom: 10,
    layout: { 'text-field': name, 'text-font': font, 'text-size': 12, 'text-letter-spacing': 0.1, 'text-max-width': 8 },
    paint: { 'text-color': '#4D4D4D', 'text-halo-color': '#BEBEBE', 'text-halo-width': 1.5 }
  });

  return {
    version: 8,
    name: 'VEXLANE 3D (black and white)',
    glyphs: V.glyphs,
    light: { anchor: 'viewport', color: '#FFFFFF', intensity: 0.55, position: [1.2, 205, 40] },
    sources: {
      [src]: { type: 'vector', url: V.tilejson, attribution: V.attribution },
      terrain: { type: 'raster-dem', tiles: V.terrain.tiles, encoding: V.terrain.encoding, tileSize: V.terrain.tileSize, maxzoom: V.terrain.maxZoom, attribution: V.terrain.attribution },
      route: { type: 'geojson', data: EMPTY, lineMetrics: true },
      route2: { type: 'geojson', data: EMPTY },
      accuracy: { type: 'geojson', data: EMPTY }
    },
    layers
  };
}
