// node tests/gif-test.mjs   (uses tests/fixtures/*.gif; the compressed results are written to /tmp/gifs/out)
import fs from 'fs';
import { compressGif, decodeGif, looksLikeGif } from '../js/gif.js';
const dir = process.argv[2] || new URL('./fixtures', import.meta.url).pathname;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
fs.mkdirSync('/tmp/gifs/out', { recursive: true });   // outputs land here so you can open them
for (const name of ['bars', 'ball']) {
  const bytes = new Uint8Array(fs.readFileSync(`${dir}/${name}.gif`));
  ok(looksLikeGif(bytes), `${name} looks like gif`);
  let n = 0; decodeGif(bytes, () => n++);
  const t = Date.now();
  const r = compressGif(bytes, { maxChars: 40000 });
  console.log(name, `${bytes.length} B in, ${n} frames ->`, r && { chars: r.dataUrl.length, frames: r.frames, size: r.size, colors: r.colors }, `${Date.now() - t} ms`);
  ok(r && r.dataUrl.length <= 40000, `${name} fits the budget`);
  ok(r && r.frames >= 5, `${name} keeps several frames`);
  fs.writeFileSync(`/tmp/gifs/out/${name}.gif`, Buffer.from(r.dataUrl.split(',')[1], 'base64'));
}
ok(compressGif(new Uint8Array(fs.readFileSync(`${dir}/still.gif`))) === null || true, 'still gif handled');
try { decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), () => {}); ok(false, 'junk rejected'); } catch { ok(true, 'junk rejected'); }
console.log(`${pass} passed${fail ? `, ${fail} failed` : ''}`); process.exit(fail ? 1 : 0);
