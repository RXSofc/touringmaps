# Live traffic colours (optional, TomTom)

An extra map layer that colours the roads by how busy they are: green is flowing, yellow is slow, red is jammed.
It is **off and invisible until you set a key**. Without a key the app is exactly what it was: no menu row, no request.

## Turn it on

1. Make a TomTom developer account and create a **new API key just for tiles** (the free plan needs no card).
   Enable the Traffic API (and Map Display, if the dashboard lists it) for that key. Look in the key's settings for a
   way to restrict it to your site's domain.
2. In `js/map-config.js`, section `traffic`, replace `YOUR_TOMTOM_TILE_KEY` with that key and commit.
3. Hard refresh. In the map menu a new row **Kemacetan** appears. Zoom in to a city: colours show from zoom 8 up.

### Why the key sits in a public file

Tiles are plain image requests made by every rider's browser, so the key cannot stay secret. That is acceptable only
because of how it is used:

- Make it a key that is used **only for tiles**. Keep your routing key (a later feature) as a secret in the Cloudflare
  Worker, never in this file.
- The free plan allows 50,000 tile requests per day, counted separately from the 2,500 non-tile requests. If a stranger
  copies the key and uses the allowance up, the traffic layer stops (the app switches it off and says so). **No money is
  involved as long as the account has no card or top-up attached.**
- Do **not** send tiles through the Cloudflare Worker: the free Worker plan allows 100,000 requests per day for the whole
  account, and traffic tiles would eat the allowance the routing proxy needs.

## How it saves the quota

- Tiles are 512 px, so one phone screen needs about 4 of them.
- Nothing is requested while the layer is off, or while the map is zoomed out below `traffic.minZoom` (8).
- It reloads every 3 minutes (`refreshMs`) while on, not continuously.
- If the first 4 tiles all fail (allowance used up, wrong key, no connection) the layer switches itself off, says so
  once, and stops asking. Map and routes are unaffected.

## NEON skin

In 3D with the NEON skin the dark twin style (`relative0-dark`) is used.

## What was verified, and what was not

Verified here with a mocked TomTom: the menu row only exists with a key, the tile URL (style, `tileSize=512`, key),
a single zoom level per screen, the credit in the attribution, remembering the switch across a reload, switching off,
the self-shutdown on refused tiles, and the 3D source and layer order. Not verified: the real TomTom servers, your key's
settings, TomTom's terms for showing their tiles on an OpenStreetMap base (the credit is shown regardless), and how
the colours look on a real phone. Read TomTom's terms before a public launch.
