# Routing without toll roads

Motorcycles may not use toll roads in Indonesia. This page explains how VEXLANE keeps routes off them, what each
piece does, and how to set it up.

## Why the public OSRM demo is not enough

The app used to ask `router.project-osrm.org` for a route with `exclude=toll`. The public demo server does **not**
support `exclude`: it answers `400 InvalidValue` (or ignores the option). The app then fell back to a plain car
route, found the toll road in it, and refused to guide it. The safety net worked, the avoidance never did.

An `exclude` is also a soft guarantee even on servers that support it. What you want is a router where toll roads
are **not in the graph at all**, or one that takes an explicit "avoid tollways" and honours it.

## The pieces

| Piece | What it does | Needs |
|---|---|---|
| **Own OSRM** (`server/osrm/`) | Builds the road graph without toll, motorway, `motorroad=yes` and `motorcycle=no` ways. No route can touch them. | A small server (Docker) |
| **ORS proxy** (`server/ors-proxy/`) | Cloudflare Worker that keeps your OpenRouteService key secret and forwards `avoid_features: tollways, highways`. | A free Cloudflare account + a free ORS key |
| **ORS direct** | Same router, called from the browser. The key is visible to every rider. Fine for a test. | A free ORS key |
| **Stops on the way** ("titik lewat") | The leader taps up to 3 points on non-toll roads; every rider's route is forced through them. Works with any router, including the public demo. | Nothing |
| **The scan** (always on) | Every answer is checked for the `toll` / `motorway` classes, the ORS toll extra and roads named "Tol". A route that still touches one is faded, its guidance is off, the toll stretch is drawn as red dashes and the phone buzzes. | Nothing |

`MAP_CONFIG.routing.chain` in `js/map-config.js` is the order they are tried in. The first usable provider answers;
the next is only asked when it is rate-limited or down. Providers that still hold a `YOUR_…` placeholder are skipped.
Default: `['osrm-own', 'ors-proxy', 'ors', 'osrm-demo']`. Keep `osrm-demo` last: it can only detect toll, not avoid it.

A hard-avoiding provider that says "no toll-free route exists" is **final**: the app shows that message and does
not fall back to a router that would happily send you onto the toll road.

## Option A: your own OSRM (strongest guarantee)

```bash
cd server/osrm
./prepare.sh                 # downloads Java from Geofabrik, extracts it with motorcycle-id.lua, ~4 GB disk
# edit Caddyfile: your DNS name and your GitHub Pages origin
docker compose up -d
```

Then in `js/map-config.js` set `'osrm-own'.baseUrl` to `https://route.example.com/route/v1/driving`.

`motorcycle-id.lua` wraps the stock `car.lua`: it drops a way when `toll=yes` (unless `toll:motorcycle=no`),
`highway=motorway|motorway_link`, `motorroad=yes` or `motorcycle=no`, and hands every other way to `car.lua`
unchanged. Rebuild the data now and then (`./prepare.sh` again) to pick up new OpenStreetMap edits.

Other islands: `REGION=sumatra ./prepare.sh` (names: download.geofabrik.de/asia/indonesia.html).

### Check it on the server

`tests/osrm_profile_test.py` proves the profile's rules in a real Lua interpreter, but it does not run OSRM. After
building the data, check a trip you know needs a toll road on a car router, for example Padalarang to Yogyakarta:

```bash
curl 'http://localhost:5000/route/v1/driving/107.4,-6.84;110.36,-7.8?overview=false&steps=true' | grep -io '"name":"[^"]*tol[^"]*"' | head
```

No output = no toll road in the route.

## Option B: OpenRouteService behind the proxy

1. Get a free key at <https://openrouteservice.org/dev/#/signup> and check your plan's request limits.
2. `cd server/ors-proxy`, edit `ALLOWED_ORIGINS` in `wrangler.toml` (your GitHub Pages origin, no path).
3. `npx wrangler deploy`, then `npx wrangler secret put ORS_API_KEY`.
4. In `js/map-config.js` set `'ors-proxy'.baseUrl` to `https://vexlane-ors-proxy.YOUR.workers.dev/directions`.

Always set `ALLOWED_ORIGINS`. Without it the worker accepts any site and your key's quota is free for everyone.

The worker rebuilds the request from a whitelist (2–5 coordinates, `tollways` / `highways` / `ferries`), so the key
cannot be used for other ORS services. ORS answers are passed through as they are; the app reads error `2009`/`2010`
("no route") and `429` (rate limit).

The app asks ORS in three steps: avoid tollways **and** highways, then tollways only, then nothing (and flag the
result if it is tolled). A self-hosted ORS that does not know the avoid option answers `400`; the app remembers that
for the session and goes on to the next step.

## Option C: stops on the way (works today, no server)

When a route is flagged, the banner says where the toll is: the tolled stretch is drawn as **red dashes** on the map.
Whoever may change the destination (the owner, or everyone when the room allows it) taps **Atur jalur**, then taps the
map on a non-toll road (Pantura, a southern road, a town on an old road). The point becomes numbered stop 1, 2 or 3
for **every** rider and the routes are recomputed through it.

- At most 3 stops (`MAP_CONFIG.routing.maxVia`; the database rules enforce the same limit).
- Stops are sorted along the way from the rider to the destination, whatever order you tapped them in.
- A stop counts as reached within 150 m (`viaReachedM`). After that, that device is never routed back to it. This is
  remembered only while the app is open: restart the app after passing a stop and it will route to it again.
- Saving a **new destination** clears the stops. "Open in Maps" carries them as waypoints.
- Remove them with **Hapus titik lewat** (or **Hapus** in the info banner).

This is a steering tool, not an automatic detour finder: you choose the road.

## Database

`rooms/{id}/destination/via/{0..2}` = `{latitude, longitude}`. `updatedAt` / `updatedBy` are written together with it
(`saveVia` in `js/rooms.js`). The rules (`firebase/database.rules.json`) allow at most indexes 0–2, valid
coordinates, no other fields, the same permission as the destination, and now check `updatedBy === auth.uid` on the
field itself. **Publish the rules** (`firebase deploy --only database`) or saving stops will be refused.

## What was and was not verified

Verified here, with mocked networks and local runtimes: the routing code (via legs, toll stretches, ORS adapter and its
error ladder, "never route back to a passed stop"), the database rules in the local evaluator, the proxy worker, the
Lua profile's rules in a real Lua interpreter, and the map overlays in a real browser (2D with real Leaflet, 3D with a
stand-in for MapLibre).

**Not** verified against live services: OpenRouteService (the request and answer formats follow its documentation:
`avoid_features`, `extra_info: tollways`, instruction types), a real OSRM build with the profile, a Cloudflare
deployment, and the Firebase emulator suite (`firebase/tests`). Run those once before a real trip.
