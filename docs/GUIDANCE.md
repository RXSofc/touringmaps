# Turn alerts (popup + vibration)

Turn-by-turn guidance for riders. **No sound** (by design): a popup card at the top of the map plus vibration.

## What it shows
Left / right, slight and sharp turns, roundabouts with the exit number ("ambil jalan keluar ke-2"), U-turn, fork, merge, ramp, end of road, arrival, and "Keluar jalur, menghitung ulang…" when you leave the route.

Not available from the routing data: traffic lights, speed bumps, speed limits, full lane guidance.

## When it fires
Three stages per maneuver, each fires once, only escalating (far -> near -> now):

| Stage | Distance before the maneuver | Vibration |
|---|---|---|
| far | speed x 30 s, clamped 200-500 m | 1 short |
| near | speed x 10 s, clamped 60-200 m | 2 short |
| now | 30 m | 1 long |

Arrival: 2 pulses. Off-route (more than max(40 m, 1.5 x GPS accuracy) away for 3 fixes in a row): 3 quick pulses and a fast reroute (at most once per 8 s). All numbers live in `APP.guidance` (js/config.js).

## No toll roads (motorcycle)
Two layers:
1. The route request asks the server to exclude toll (`exclude=toll`). If the server refuses that option the app retries without it and remembers that.
2. Every returned route is scanned for `toll` / `motorway` road classes. If any appear, the route is flagged with a red banner and guidance is switched off for it.

If the destination can only be reached via toll, you get "no toll-free route" instead of a toll route.

**Limits, be honest about them:** this depends on OSM tagging and on the routing server. The public OSRM demo is a *car* profile, has no traffic, and is not validated for motorcycles (it may also use roads motorbikes can't, or skip ones they can). For serious use host your own OSRM with a motorcycle/bike-friendly profile (`osrm-own` in js/map-config.js). Always glance at the route before riding.

## Platform limits
- Works only while the page is active: keep the screen on (Room menu -> Keep screen on). A locked screen pauses GPS in browsers/WebViews.
- `navigator.vibrate` may be missing in some WebViews; the popup is the primary channel.
- Each rider has their own route (from their own position). Switch it off per device: Room menu -> Turn alerts.
- Not yet tested on a real phone/AppMint WebView; tested with simulated GPS only (tests/guidance-sim.mjs).
