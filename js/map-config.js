/**
 * Map provider configuration: tiles, geocoding, routing.
 *
 * Every provider is data. Swap one by editing this file only; the map, search
 * and route code read these tables and never hard-code a service. To add a
 * service that speaks the same protocol (Nominatim-style, Photon-style,
 * OSRM-style) add an entry and put its id in the matching `chain`. A different
 * protocol needs an adapter in js/destinations.js or js/routing.js.
 *
 * RULES THIS FILE FOLLOWS
 *  - Defaults use only free, key-less OpenStreetMap-ecosystem endpoints, which
 *    are for LIGHT, development-scale use. They are not production infrastructure
 *    (see docs/MAP-PROVIDERS.md for the exact limits and how to move off them).
 *  - Nothing here is a real API key. Keyed providers ship with `YOUR_…`
 *    placeholders and are skipped until you replace them AND add the provider id
 *    to a `chain`. No paid service is ever used silently.
 *  - A key placed here is visible to every user. Use a key that is restricted
 *    (HTTP-referrer / domain allow-list, quota cap) at the provider, and never
 *    put a server-side secret in frontend code.
 *  - `chain` = ordered fallback list. The first usable provider is tried first;
 *    on timeout / network / rate-limit / server errors the next is tried.
 */

/* --------------------------------------------------------------- providers */

const TILE_PROVIDERS = {
  // OpenStreetMap Foundation standard tiles. Free, no key. Tile usage policy:
  // https://operations.osmfoundation.org/policies/tiles/  (light use, valid Referer,
  // visible attribution, no bulk download/prefetch, no heavy or commercial-scale traffic).
  osm: {
    label: 'OpenStreetMap standard',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: 'abc',
    requiresKey: false,
    policyUrl: 'https://operations.osmfoundation.org/policies/tiles/'
  },

  // ---- Placeholders: need an account (and maybe billing). Check each provider's
  // ---- current terms and pricing before enabling. Add the id to tiles.chain to use.
  maptiler: {
    label: 'MapTiler (raster, key required)',
    url: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={apiKey}',
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 21,
    requiresKey: true,
    apiKey: 'YOUR_MAPTILER_KEY',     // restrict to your github.io domain in the MapTiler dashboard
    policyUrl: 'https://www.maptiler.com/terms/'
  },
  stadia: {
    label: 'Stadia Maps (key or domain auth)',
    url: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key={apiKey}',
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 20,
    requiresKey: true,
    apiKey: 'YOUR_STADIA_KEY',
    policyUrl: 'https://stadiamaps.com/terms-of-service/'
  }
};

const GEOCODER_PROVIDERS = {
  // OSM Nominatim public instance. Policy: https://operations.osmfoundation.org/policies/nominatim/
  // max ~1 request/second, no search-as-you-type/autocomplete, cache results, identify your app
  // (the browser sends your site as Referer), no bulk geocoding. No SLA.
  nominatim: {
    label: 'OSM Nominatim (public)',
    type: 'nominatim',
    baseUrl: 'https://nominatim.openstreetmap.org',
    minIntervalMs: 1100,
    requiresKey: false,
    policyUrl: 'https://operations.osmfoundation.org/policies/nominatim/'
  },
  // Photon (Komoot) public demo. Fair use only, no SLA; fine as a development fallback.
  photon: {
    label: 'Photon (public demo)',
    type: 'photon',
    baseUrl: 'https://photon.komoot.io',
    minIntervalMs: 1100,
    requiresKey: false,
    policyUrl: 'https://photon.komoot.io/'
  },
  // Placeholder: a hosted Nominatim-compatible API that needs a key (check region host + terms).
  locationiq: {
    label: 'LocationIQ (key required)',
    type: 'nominatim',
    baseUrl: 'https://us1.locationiq.com/v1',
    apiKeyParam: 'key',
    apiKey: 'YOUR_LOCATIONIQ_KEY',   // restrict by domain in the provider dashboard
    minIntervalMs: 600,
    requiresKey: true,
    policyUrl: 'https://locationiq.com/terms'
  }
};

const ROUTING_PROVIDERS = {
  // Public OSRM demo server: free, no key, CAR profile only, no SLA, light use only.
  // It does not know live traffic or motorcycle rules. Not production infrastructure.
  'osrm-demo': {
    label: 'OSRM public demo (car)',
    type: 'osrm',
    baseUrl: 'https://router.project-osrm.org/route/v1/driving',
    minIntervalMs: 1000,
    requiresKey: false,
    policyUrl: 'https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server'
  },
  // Placeholder: your own OSRM (or an OSRM-compatible hosted service). Replace baseUrl,
  // and add apiKey/apiKeyParam only if that service requires one.
  'osrm-own': {
    label: 'Self-hosted / hosted OSRM',
    type: 'osrm',
    baseUrl: 'https://YOUR_OSRM_HOST/route/v1/driving',
    minIntervalMs: 300,
    requiresKey: false
  }
};

/* ------------------------------------------------------------------ config */

export const MAP_CONFIG = Object.freeze({
  view: Object.freeze({
    defaultCenter: [-2.5, 118],   // Indonesia, shown until a position is known
    defaultZoom: 5,
    followZoom: 16
  }),

  tiles: Object.freeze({
    chain: ['osm'],               // first usable provider wins; later ones replace it if tiles keep failing
    errorsBeforeFallback: 3,      // consecutive tile errors before switching provider
    providers: TILE_PROVIDERS
  }),

  geocoder: Object.freeze({
    chain: ['nominatim', 'photon'],
    providers: GEOCODER_PROVIDERS,
    language: 'en',
    countryCodes: '',             // e.g. 'id' to restrict results; '' = worldwide
    contactEmail: '',             // optional; sent as `email=` to Nominatim so the operators can reach you
    limit: 6,
    timeoutMs: 10000,
    cooldownMs: 60000,            // after a 429/403 a provider is skipped for this long
    autoSearch: false,            // Nominatim forbids autocomplete: search runs on submit. Only enable with a typeahead-friendly provider.
    debounceMs: 900,
    minChars: 3
  }),

  routing: Object.freeze({
    chain: ['osrm-demo'],
    providers: ROUTING_PROVIDERS,
    overview: 'simplified',
    timeoutMs: 12000,
    cooldownMs: 60000,
    recalcMoveMeters: 300,        // re-route after moving this far from the route origin…
    minRecalcIntervalMs: 30000,   // …and at least this long since the last request
    offRouteMeters: 150,          // treat the route as invalid beyond this distance
    manualMinIntervalMs: 3000
  })
});

/* ------------------------------------------------------------------ helpers */

const warned = new Set();
const isPlaceholder = (v) => typeof v !== 'string' || v === '' || /YOUR_/i.test(v);

/** Why a provider cannot be used, or null if it can. */
export function providerProblem(p) {
  if (!p) return 'unknown provider';
  if (p.requiresKey && isPlaceholder(p.apiKey)) return 'API key not set';
  if (typeof p.baseUrl === 'string' && !/^https:\/\//.test(p.baseUrl)) return 'baseUrl must be https';
  if (typeof p.baseUrl === 'string' && /YOUR_/i.test(p.baseUrl)) return 'baseUrl is still a placeholder';
  if (typeof p.url === 'string' && !/^https:\/\//.test(p.url)) return 'url must be https';
  if (p.url !== undefined && !p.attribution) return 'attribution is required';
  return null;
}

/**
 * The usable providers of a section, in fallback order. Entries that are
 * misconfigured (placeholder key, missing attribution…) are skipped with a
 * console warning rather than used.
 * @param {'tiles'|'geocoder'|'routing'} section
 * @returns {Array<object & {id:string}>}
 */
export function usableProviders(section) {
  const cfg = MAP_CONFIG[section];
  const out = [];
  for (const id of cfg.chain) {
    const p = cfg.providers[id];
    const problem = providerProblem(p);
    if (problem) {
      if (!warned.has(`${section}/${id}`)) { warned.add(`${section}/${id}`); console.warn(`[map-config] ${section} provider "${id}" skipped: ${problem}.`); }
      continue;
    }
    out.push({ id, ...p });
  }
  return out;
}
