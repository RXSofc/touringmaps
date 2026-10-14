# Map providers: configuration, limits, and moving to production

All provider settings live in **`js/map-config.js`**. Firebase settings stay in **`js/config.js`** (copy them from Firebase console → Project settings → Your apps; this project never invents or edits project identifiers).

The map code (`js/map.js`, `js/destinations.js`, `js/routing.js`) reads those tables and does not hard-code any service. To replace a provider, edit the table and the `chain` list; no other file changes.

## What ships by default (all free, no API key)

| Job | Default chain | Protocol |
|---|---|---|
| Map tiles | OpenStreetMap standard tiles | XYZ raster, rendered by Leaflet.js |
| Place search | OSM Nominatim → Photon (Komoot) as fallback | Nominatim / Photon JSON |
| Reverse lookup (name for a tapped point) | same chain | same |
| Routes | OSRM public demo (car profile) | OSRM `route/v1` |
| Manual latitude/longitude | built in, needs no provider | validated locally |

`chain` is an ordered fallback list. On timeout, network failure, HTTP 429/403 or a 5xx error the next provider is tried. After a 429/403 a provider is skipped for `cooldownMs` (60 s) so the app does not keep hammering it. "No route found" is final (another router would say the same) and is shown to the user. If every provider fails, the user sees a clear message and the **Enter coordinates** shortcut.

## Throttling and error handling (settings in `map-config.js`)

- Geocoding: one request per `minIntervalMs` per provider (1.1 s for the public services), search runs **on submit only** (`autoSearch: false`), results are cached in memory, minimum 3 characters.
- Routing: a route is requested only when the destination changes, you move `recalcMoveMeters` (300 m) away from where the route started and at least `minRecalcIntervalMs` (30 s) passed, you leave the route line, or you press refresh (`manualMinIntervalMs` 3 s). Each provider also has its own `minIntervalMs`.
- Tiles: if `errorsBeforeFallback` (3) consecutive tiles fail, the next tile provider in `tiles.chain` replaces the current one. When none is left the app shows "Map tiles are not loading" and keeps working (positions are still accurate).
- Everything has a timeout, can be cancelled, and returns typed errors with plain-language messages.
- The tile layer's attribution is always visible; a tile provider without attribution is rejected at load.

## Honest limitations of the default providers

Do **not** treat the defaults as production infrastructure. They are fine for development and for a small private group riding occasionally.

**OpenStreetMap tiles (`tile.openstreetmap.org`)**
- Run by volunteers, no SLA, may be slow or blocked without warning.
- Policy ([operations.osmfoundation.org/policies/tiles](https://operations.osmfoundation.org/policies/tiles/)): light use, a valid Referer (browsers send your site), visible attribution, no bulk download or pre-fetching, no heavy or commercial-scale traffic. This app never prefetches tiles and does not cache them offline.
- Raster style only; no offline maps; no motorcycle-specific styling.

**Nominatim public (`nominatim.openstreetmap.org`)**
- Max about 1 request/second, **no search-as-you-type**, results should be cached, no bulk geocoding, no SLA ([policy](https://operations.osmfoundation.org/policies/nominatim/)). It can block an app that abuses it.
- Search quality depends on OSM coverage of the place. Small villages, shops and some addresses in Indonesia can be missing; manual coordinates and "tap the map" exist for exactly that.
- Optional: set `geocoder.contactEmail` so operators can contact you instead of blocking you.

**Photon public demo (`photon.komoot.io`)**
- Fair-use demo with no SLA; used here only as a fallback. Results can differ from Nominatim.

**OSRM public demo (`router.project-osrm.org`)**
- Light use, **car profile only**, no SLA, no live traffic, no road closures, **not checked for motorcycle suitability**, may be down or rate-limited. Durations are estimates. The UI says so wherever an ETA is shown and offers "Open in Maps" for turn-by-turn.
- Public OSRM does not offer a motorcycle profile; that needs your own routing server or a commercial router that does.

**Not production-ready as shipped.** For anything beyond a small private group, move each job to a provider you have an agreement with (below).

## Moving to your own / paid providers

Rules of thumb for every provider: create an account, read its **current** terms and pricing, add a **spending cap / quota alert**, and restrict the key. Never put a server-side secret in frontend code; a key in `map-config.js` is visible to every user, so it must be a browser key restricted to your site (HTTP-referrer / domain allow-list such as `https://YOUR-USERNAME.github.io/*`, plus a request quota).

**Tiles (placeholders already in the file: `maptiler`, `stadia`)**
1. Create the account and a key at the provider; restrict it to your github.io domain and set a quota.
2. In `TILE_PROVIDERS` replace `YOUR_…_KEY` with the key.
3. Put the provider id first in `tiles.chain`, e.g. `['maptiler', 'osm']`.
4. Keep the attribution string the provider requires.
Until a placeholder is replaced the provider is skipped (a console warning says why), so a paid service can never be used by accident.

**Geocoding (placeholder: `locationiq`)**
Same steps; `GEOCODER_PROVIDERS.locationiq.apiKey`, then `geocoder.chain: ['locationiq', 'nominatim']`. Check the provider's regional host (`us1` / `eu1` / `ap…`) and whether its terms allow storing results. Any Nominatim-compatible service fits `type: 'nominatim'`; a Photon-compatible one fits `type: 'photon'`. A different API needs an adapter in `js/destinations.js` (`ADAPTERS`).

**Routing (placeholder: `osrm-own`)**
1. Run your own OSRM (Docker image `osrm/osrm-backend`, a regional OpenStreetMap extract such as Java, and a profile; motorcycle needs a custom Lua profile) or use an OSRM-compatible hosted service.
2. Set `ROUTING_PROVIDERS['osrm-own'].baseUrl` to `https://YOUR_HOST/route/v1/driving` (HTTPS is required because the app is served over HTTPS), enable CORS for your site, and add `apiKey` + `apiKeyParam` only if the service needs a key.
3. `routing.chain: ['osrm-own', 'osrm-demo']`.

## Checklist before calling it production-ready

- [ ] Tiles come from a provider whose terms cover your traffic (or you are certain you stay inside OSM's light-use policy).
- [ ] Place search uses a provider with an SLA, or you accept that search may fail (manual coordinates always work).
- [ ] Routing uses your own server or a commercial router; you have decided what "motorcycle" means for your roads.
- [ ] Every browser-visible key is restricted by domain and quota, with billing alerts.
- [ ] Attribution is visible for every provider in use.
- [ ] `contactEmail` is set for Nominatim if you still use it.
- [ ] You tested with the provider blocked (devtools → block request URL) and the app still lets you set a destination by coordinates.

## Toll roads
Routing requests use `exclude=toll` and the result is scanned for toll/motorway classes (`routing.avoid`, `routing.blockClasses` in js/map-config.js). Details and limits: [GUIDANCE.md](GUIDANCE.md).
