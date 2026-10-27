# Profile photos and animated GIFs

Photos are stored in the database as small data URLs (no Firebase Storage, which needs a billing plan). The same
string is copied into every room the rider is in, so it has to stay small.

| Kind | Limit | How |
| --- | --- | --- |
| JPEG / PNG / WebP | 15 000 characters | redrawn on a canvas to 96 px, saved as JPEG |
| Animated GIF | 40 000 characters (about 30 KB) | `js/gif.js` |
| Link (https) | URL only | the browser loads it; a GIF link animates by itself |

## What gif.js does

1. Reads every frame of the GIF itself (disposal, transparency, interlacing, local palettes).
2. Crops to a centred square and averages it down to 72 px (transparent pixels are flattened onto the paper colour).
3. Builds one palette (median cut), starting at 64 colours.
4. Stores only the rectangle that changes from one frame to the next.
5. If the result is over the limit it tries fewer colours, then fewer frames (down to 5), then a smaller size (down to 40 px), and
   gives up with a readable message only if nothing fits.

A GIF with a single frame is treated as a normal picture (JPEG).

## Database rules

`firebase/database.rules.json` allows `data:image/gif;base64,...` up to 40 000 characters for `users/{uid}/avatarUrl` and
`rooms/{id}/members/{uid}/avatarUrl`. **Publish the rules again** after updating, or saving a GIF avatar is refused with
"Animated GIF avatars need the updated database rules". JPEG/PNG/WebP and links keep working without it.

## Cost to keep in mind

A 30 KB avatar is sent to every rider when they open the room. A room of 30 riders with GIF avatars is up to about 1 MB on join.
Free Firebase plan limits are in the README.
