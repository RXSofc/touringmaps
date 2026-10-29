# Neon Night map skin

A dark, glowing night-city look for the 3D map. It is original styling (no game assets, logos or fonts), switched
on and off with the **NEON** button next to 3D. The choice is remembered per phone (`tt.skin`). The flat map is not skinned.

## Colours (only inside the map)

| Role | Colour |
| --- | --- |
| Ground, casings | Deep Blue-Black `#0d0e15` |
| Blocks, built-up land | Charcoal `#1a1a24` |
| Water, route casing | Midnight Violet `#120136` |
| Main roads (primary) | Cyber Yellow `#fcee0a` |
| Secondary roads, grid, other riders' route | Electric Cyan `#00f0ff` |
| Small streets, paths | Dimmed Teal `#008080` |
| Boundaries, rivers, tall buildings | Muted Purple `#400082` |
| Toll-prone roads (motorway, trunk) | Hazard Orange `#ff5e00` |
| Points of interest | Acid Green `#39ff14` |
| Road names, places | Laser White `#e6ffff` |
| My route | Neon Magenta `#ff007f`, fading to a soft pink-white at the destination, with a magenta halo |

Rider markers get cyan outlines with a magenta hard offset, a green live dot and a yellow outline for you. The
destination icon becomes a holographic beacon: a glowing ring on the exact spot, a cyan beam and a yellow data tag
with a magenta/cyan finish check.

## How it works

`SKIN_OPS` in `js/map-style.js` lists `[layer, property, default, neon]`. `TouringMap3D.setSkin()` flips them with
`setPaintProperty`, shows three halo layers (`road-glow-secondary`, `road-glow-primary`, `route-glow`, hidden when
the skin is off so the default map costs nothing extra) and changes the light. Nothing is rebuilt, so the route,
riders and hills stay as they are. Marker colours come from the `map--neon` class on the map container
(`css/components.css`). `tests/skin-test.mjs` checks the table against `buildStyle()`.

To change a colour, edit its neon value in `SKIN_OPS` (and the matching line above if you keep this table).

## Not verified here

The build sandbox cannot load real map tiles, so the final look on real roads and buildings has to be checked on a phone.
