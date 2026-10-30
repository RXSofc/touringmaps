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
/** Gentle relief: the map is almost flat, hills only read as a soft shading. */
export const HILL_SOFT = 0.3;
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
      'hillshade-exaggeration': HILL_SOFT,
      'hillshade-shadow-color': '#6B6B6B',
      'hillshade-highlight-color': '#FFFFFF',
      'hillshade-accent-color': '#A8A8A8',
      'hillshade-illumination-direction': 335
    }
  });

  // Flat footprints at every zoom: cheap, and they sit under the extrusions. Where the map data marks a building
  // outline `hide_3d` (its parts are meant to be drawn instead) and the parts do not cover it all, this keeps the
  // building visible as a flat footprint instead of leaving a hole in the map.
  add({
    id: 'building-flat', type: 'fill', source: src, 'source-layer': 'building', minzoom: 13,
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
  // neon skin only: a wide soft halo under the main roads (hidden otherwise, so the default map costs nothing extra)
  for (const [id, classes, color, w] of [['secondary', ['secondary'], '#00f0ff', [9, 3, 14, 10, 18, 28]], ['primary', ['primary'], '#fcee0a', [8, 3, 14, 12, 18, 32]]]) {
    add({
      id: `road-glow-${id}`, type: 'line', source: src, 'source-layer': 'transportation', minzoom: w[0],
      filter: ['all', tunnelOff, inClass(classes)], layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': zoomWidth(...w), 'line-blur': 6, 'line-opacity': 0.32 }
    });
  }
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
  add({
    id: 'route-glow', type: 'line', source: 'route', layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ff007f', 'line-width': zoomWidth(8, 10, 18, 40), 'line-blur': 8, 'line-opacity': 0.5 }
  });
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


/* ------------------------------------------------------------------------------------------
 * "Neon Night" skin: a dark, glowing night-city look for the 3D map (colours only live inside the map).
 * Every entry is [layer, paint property, default value, neon value]; the map flips them with setPaintProperty,
 * so the route, the riders and the hills are never rebuilt. tests/skin-test.mjs checks the defaults against buildStyle().
 * ------------------------------------------------------------------------------------------ */
export const NEON = Object.freeze({
  void: '#0d0e15', charcoal: '#1a1a24', violet: '#120136', cyan: '#00f0ff', magenta: '#ff007f', yellow: '#fcee0a',
  teal: '#008080', purple: '#400082', green: '#39ff14', white: '#e6ffff', orange: '#ff5e00'
});
const N = NEON;
const NEON_ROUTE_STOPS = [[0, N.magenta], [0.55, '#ff5fb0'], [1, '#ffe3f3']];
const gradient = (stops) => ['interpolate', ['linear'], ['line-progress'], ...stops.flat()];

export const SKIN_OPS = [
  ['background', 'background-color', '#F1F1F1', N.void],
  ['landcover', 'fill-color', ['match', ['get', 'class'], ['wood', 'grass', 'farmland'], '#E4E4E4', '#EAEAEA'], ['match', ['get', 'class'], ['wood', 'grass', 'farmland'], '#10131c', '#0f1019']],
  ['landuse', 'fill-color',
    ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], '#EBEBEB', ['cemetery', 'hospital', 'school', 'college', 'stadium', 'pitch'], '#E0E0E0', '#EEEEEE'],
    ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], N.charcoal, ['cemetery', 'hospital', 'school', 'college', 'stadium', 'pitch'], '#16162a', '#12131c']],
  ['park', 'fill-color', '#DEDEDE', '#0e2428'],
  ['water', 'fill-color', '#BEBEBE', N.violet],
  ['waterway', 'line-color', '#BEBEBE', N.purple],
  ['hillshade', 'hillshade-shadow-color', '#6B6B6B', '#04040a'],
  ['hillshade', 'hillshade-highlight-color', '#FFFFFF', '#2b2f78'],
  ['hillshade', 'hillshade-accent-color', '#A8A8A8', N.violet],
  ['building-flat', 'fill-color', '#D9D9D9', '#5a0830'],
  ['building-flat', 'fill-outline-color', '#B5B5B5', N.purple],
  ['rail', 'line-color', '#8C8C8C', '#7a2bd6'],
  ['path', 'line-color', '#9C9C9C', N.teal],
  ...ROADS.map((g) => [`road-casing-${g.id}`, 'line-color', '#141616', N.void]),
  ['road-minor', 'line-color', '#FFFFFF', N.teal],
  ['road-tertiary', 'line-color', '#FFFFFF', '#00a8b3'],
  ['road-secondary', 'line-color', '#FFFFFF', N.cyan],
  ['road-primary', 'line-color', '#FFFFFF', N.yellow],
  ['road-motorway', 'line-color', '#9A9A9A', N.orange],     // toll-prone roads stay visibly different: hazard orange
  ['building-outline', 'line-color', '#6E6E6E', N.cyan],
  ['building-outline', 'line-opacity', 0.9, 0.45],
  ['building-3d', 'fill-extrusion-color',
    ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, '#FFFFFF', 12, '#F0F0F0', 30, '#D9D9D9', 80, '#BDBDBD', 200, '#9A9A9A'],
    ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, '#7a0640', 12, '#9c0a52', 30, '#c20a5e', 80, '#e0006e', 200, '#ff2d95']],
  ['poi-dot', 'circle-color', '#141616', N.green],
  ['poi-dot', 'circle-stroke-color', '#FFFFFF', N.void],
  ['accuracy-fill', 'fill-color', '#141616', N.cyan],
  ['accuracy-fill', 'fill-opacity', 0.08, 0.14],
  ['accuracy-line', 'line-color', '#141616', N.cyan],
  ['route2-casing', 'line-color', '#141616', N.void],
  ['route2-line', 'line-color', '#FFFFFF', N.cyan],
  ['route-casing', 'line-color', ROUTE_CASING, N.violet],
  ['route-line', 'line-gradient', gradient(ROUTE_STOPS), gradient(NEON_ROUTE_STOPS)],
  ['road-label', 'text-color', '#141616', N.white], ['road-label', 'text-halo-color', '#FFFFFF', N.void],
  ['place-label', 'text-color', '#141616', N.white], ['place-label', 'text-halo-color', '#FFFFFF', N.void],
  ['poi-label', 'text-color', '#141616', N.green], ['poi-label', 'text-halo-color', '#FFFFFF', N.void],
  ['housenumber', 'text-color', '#4D4D4D', '#8f95c4'], ['housenumber', 'text-halo-color', '#FFFFFF', N.void],
  ['water-label', 'text-color', '#4D4D4D', N.cyan], ['water-label', 'text-halo-color', '#BEBEBE', N.violet]
];
export const SKIN_GLOW_LAYERS = ['road-glow-secondary', 'road-glow-primary', 'route-glow'];
export const LIGHT_DEFAULT = { anchor: 'viewport', color: '#FFFFFF', intensity: 0.55, position: [1.2, 205, 40] };
export const LIGHT_NEON = { anchor: 'viewport', color: '#ffe0f0', intensity: 0.62, position: [1.2, 205, 40] };
