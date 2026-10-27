/**
 * Animated GIF avatars, with no library.
 *
 * A profile photo lives in the database as a data URL and is copied to every rider in the room,
 * so it has to be tiny. compressGif() reads an animated GIF, shrinks it to a small square, reduces
 * the colours, stores only what changes from frame to frame, and keeps trying smaller settings
 * until the result fits `maxChars`. The browser then plays it by itself wherever an <img> shows it.
 *
 * The pure functions (decodeGif, encodeGif, ...) work on plain arrays, so they run in Node for tests.
 */

const PAPER = [230, 227, 225];   // transparent pixels are flattened onto the page colour

/* ------------------------------------------------------------------ decoding */

function lzwDecode(data, minCodeSize, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let bits = 0; let nbits = 0; let pos = 0; let o = 0; let prev = -1; let first = 0;
  while (o < pixelCount) {
    while (nbits < codeSize && pos < data.length) { bits |= data[pos++] << nbits; nbits += 8; }
    if (nbits < codeSize) break;
    let code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize; nbits -= codeSize;
    if (code === clear) { codeSize = minCodeSize + 1; nextCode = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let sp = 0; let cur = code;
    if (prev === -1) { out[o++] = suffix[code]; prev = code; first = suffix[code]; continue; }
    if (code >= nextCode) { stack[sp++] = first; cur = prev; }
    while (cur >= clear) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
    first = suffix[cur];
    stack[sp++] = first;
    while (sp > 0 && o < pixelCount) out[o++] = stack[--sp];
    if (nextCode < 4096) {
      prefix[nextCode] = prev; suffix[nextCode] = first; nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

/**
 * Reads a GIF and calls onFrame({rgba, delay}) with each fully composed frame (width*height*4, RGBA).
 * Honors disposal, transparency, interlacing and local palettes. Frames are handed over one at a
 * time so a long GIF never sits in memory as full-size frames.
 * @returns {{width:number,height:number,frames:number}}
 */
export function decodeGif(bytes, onFrame, { maxFrames = 400, maxPixels = 4_000_000 } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('That is not a GIF file.');
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  if (!width || !height) throw new Error('That GIF has no size.');
  if (width * height > maxPixels) throw new Error('That GIF is too large to read.');
  const flags = b[10];
  const bg = b[11];
  let pos = 13;
  let globalPal = null;
  if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); globalPal = b.subarray(pos, pos + n); pos += n; }

  const canvas = new Uint8ClampedArray(width * height * 4);   // composed picture so far
  let frames = 0;
  let gce = null;
  const readSub = () => {   // concatenates data sub-blocks
    const parts = []; let total = 0;
    while (pos < b.length && b[pos] !== 0) { const n = b[pos]; parts.push(b.subarray(pos + 1, pos + 1 + n)); total += n; pos += n + 1; }
    pos++;
    const out = new Uint8Array(total); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
    return out;
  };

  while (pos < b.length) {
    const t = b[pos++];
    if (t === 0x3B) break;
    if (t === 0x21) {
      const label = b[pos++];
      if (label === 0xF9) { const size = b[pos]; gce = { disposal: (b[pos + 1] >> 2) & 7, transparent: (b[pos + 1] & 1) ? b[pos + 4] : -1, delay: (b[pos + 2] | (b[pos + 3] << 8)) * 10 }; pos += size + 1; while (b[pos] !== 0 && pos < b.length) pos += b[pos] + 1; pos++; }
      else readSub();
      continue;
    }
    if (t !== 0x2C) continue;
    const ix = b[pos] | (b[pos + 1] << 8); const iy = b[pos + 2] | (b[pos + 3] << 8);
    const iw = b[pos + 4] | (b[pos + 5] << 8); const ih = b[pos + 6] | (b[pos + 7] << 8);
    const f = b[pos + 8]; pos += 9;
    let pal = globalPal;
    if (f & 0x80) { const n = 3 * (1 << ((f & 7) + 1)); pal = b.subarray(pos, pos + n); pos += n; }
    const minCode = b[pos++];
    const data = readSub();
    const idx = lzwDecode(data, minCode, iw * ih);
    const g = gce || { disposal: 0, transparent: -1, delay: 100 };
    gce = null;
    if (!pal) continue;

    const saved = g.disposal === 3 ? canvas.slice() : null;
    const interlaced = !!(f & 0x40);
    const rowOf = (r) => {
      if (!interlaced) return r;
      const pass1 = Math.ceil(ih / 8); const pass2 = Math.ceil((ih - 4) / 8); const pass3 = Math.ceil((ih - 2) / 4);
      if (r < pass1) return r * 8;
      if (r < pass1 + pass2) return (r - pass1) * 8 + 4;
      if (r < pass1 + pass2 + pass3) return (r - pass1 - pass2) * 4 + 2;
      return (r - pass1 - pass2 - pass3) * 2 + 1;
    };
    for (let r = 0; r < ih; r++) {
      const y = iy + rowOf(r);
      if (y >= height) continue;
      for (let c = 0; c < iw; c++) {
        const x = ix + c; if (x >= width) continue;
        const v = idx[r * iw + c];
        if (v === g.transparent) continue;
        const o = (y * width + x) * 4;
        canvas[o] = pal[v * 3]; canvas[o + 1] = pal[v * 3 + 1]; canvas[o + 2] = pal[v * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    frames++;
    onFrame({ rgba: canvas, delay: g.delay, width, height });
    if (g.disposal === 2) {
      for (let y = iy; y < Math.min(height, iy + ih); y++) for (let x = ix; x < Math.min(width, ix + iw); x++) { const o = (y * width + x) * 4; canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0; }
    } else if (g.disposal === 3 && saved) canvas.set(saved);
    if (frames >= maxFrames) break;
  }
  void bg;
  return { width, height, frames };
}

/* ------------------------------------------------------------------ resampling */

/** Box-average a centre-cropped square of an RGBA (or RGB, channels = 3) frame down to size x size, flattened on PAPER. */
export function squareDown(rgba, width, height, size, channels = 4) {
  const side = Math.min(width, height);
  const sx = (width - side) / 2; const sy = (height - side) / 2;
  const out = new Uint8Array(size * size * 3);
  const step = side / size;
  for (let y = 0; y < size; y++) {
    const y0 = sy + y * step; const y1 = y0 + step;
    for (let x = 0; x < size; x++) {
      const x0 = sx + x * step; const x1 = x0 + step;
      let r = 0; let g = 0; let bl = 0; let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          const o = (Math.min(height - 1, yy) * width + Math.min(width - 1, xx)) * channels;
          const a = channels === 4 ? rgba[o + 3] / 255 : 1;
          r += (rgba[o] * a + PAPER[0] * (1 - a)) * w; g += (rgba[o + 1] * a + PAPER[1] * (1 - a)) * w; bl += (rgba[o + 2] * a + PAPER[2] * (1 - a)) * w;
          wsum += w;
        }
      }
      const o2 = (y * size + x) * 3;
      out[o2] = Math.round(r / wsum); out[o2 + 1] = Math.round(g / wsum); out[o2 + 2] = Math.round(bl / wsum);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ colours */

/** Median cut over a 5-bit-per-channel histogram. Returns up to `n` [r,g,b] colours. */
export function buildPalette(frames, n) {
  const hist = new Map();
  for (const px of frames) for (let i = 0; i < px.length; i += 3) {
    const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let boxes = [[...hist.entries()].map(([k, c]) => ({ r: (k >> 10) << 3 | 4, g: ((k >> 5) & 31) << 3 | 4, b: (k & 31) << 3 | 4, c }))];
  const range = (box) => {
    let r0 = 255; let r1 = 0; let g0 = 255; let g1 = 0; let b0 = 255; let b1 = 0;
    for (const p of box) { r0 = Math.min(r0, p.r); r1 = Math.max(r1, p.r); g0 = Math.min(g0, p.g); g1 = Math.max(g1, p.g); b0 = Math.min(b0, p.b); b1 = Math.max(b1, p.b); }
    return [r1 - r0, g1 - g0, b1 - b0];
  };
  while (boxes.length < n) {
    let bi = -1; let best = 0;
    boxes.forEach((box, i) => { if (box.length < 2) return; const m = Math.max(...range(box)) * Math.sqrt(box.reduce((s, p) => s + p.c, 0)); if (m > best) { best = m; bi = i; } });
    if (bi < 0) break;
    const box = boxes[bi]; const rg = range(box); const ch = rg[0] >= rg[1] && rg[0] >= rg[2] ? 'r' : rg[1] >= rg[2] ? 'g' : 'b';
    box.sort((a, c) => a[ch] - c[ch]);
    const total = box.reduce((s, p) => s + p.c, 0); let acc = 0; let cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i].c; cut = i + 1; if (acc >= total / 2) break; }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    let r = 0; let g = 0; let bl = 0; let w = 0;
    for (const p of box) { r += p.r * p.c; g += p.g * p.c; bl += p.b * p.c; w += p.c; }
    return [Math.round(r / w), Math.round(g / w), Math.round(bl / w)];
  });
}

/** Nearest palette index for every pixel of an RGB frame (cached per colour). */
export function indexFrame(px, palette, cache = new Map()) {
  const out = new Uint8Array(px.length / 3);
  for (let i = 0, j = 0; i < px.length; i += 3, j++) {
    const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let v = cache.get(k);
    if (v === undefined) {
      let best = 0; let bd = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = px[i] - palette[p][0]; const dg = px[i + 1] - palette[p][1]; const db = px[i + 2] - palette[p][2];
        const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (d < bd) { bd = d; best = p; }
      }
      v = best; cache.set(k, v);
    }
    out[j] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ encoding */

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize; const eoi = clear + 1;
  const out = []; let cur = 0; let nbits = 0;
  const emit = (code, size) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; } };
  let codeSize = minCodeSize + 1; let next = eoi + 1;
  let dict = new Map();
  emit(clear, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]; const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, codeSize);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else { emit(clear, codeSize); dict = new Map(); codeSize = minCodeSize + 1; next = eoi + 1; }
    prefix = c;
  }
  emit(prefix, codeSize); emit(eoi, codeSize);
  if (nbits > 0) out.push(cur & 255);
  return out;
}

/**
 * @param {{indices:Uint8Array, delay:number}[]} frames   palette indices, size x size, delay in ms
 * @param {number[][]} palette
 * Only the part that changed from the previous frame is stored (the rest is marked transparent).
 */
export function encodeGif(frames, palette, size) {
  let bitsPerPixel = 1; while ((1 << bitsPerPixel) < palette.length + 1) bitsPerPixel++;   // +1 for the transparent entry
  const tableSize = 1 << bitsPerPixel; const tIndex = palette.length;
  const out = [];
  const push = (...v) => { for (const x of v) out.push(x); };
  const word = (n) => push(n & 255, (n >> 8) & 255);
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); word(size); word(size);
  push(0x80 | 0x70 | (bitsPerPixel - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) { const c = palette[i] || [0, 0, 0]; push(c[0], c[1], c[2]); }
  push(0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map((ch) => ch.charCodeAt(0)), 0x03, 0x01, 0, 0, 0);   // loop forever
  let prev = null;
  for (const fr of frames) {
    const delay = Math.max(2, Math.round(fr.delay / 10));
    let x0 = 0; let y0 = 0; let x1 = size - 1; let y1 = size - 1; let data = fr.indices; let transparent = false;
    if (prev) {
      x0 = size; y0 = size; x1 = -1; y1 = -1;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (fr.indices[y * size + x] !== prev[y * size + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) { x0 = y0 = x1 = y1 = 0; }   // identical frame: a single transparent pixel keeps the timing
      const w = x1 - x0 + 1; const h = y1 - y0 + 1;
      data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = fr.indices[(y0 + y) * size + x0 + x];
        data[y * w + x] = v === prev[(y0 + y) * size + x0 + x] ? tIndex : v;
      }
      transparent = true;
    }
    const w = x1 - x0 + 1; const h = y1 - y0 + 1;
    push(0x21, 0xF9, 4, (1 << 2) | (transparent ? 1 : 0)); word(delay); push(transparent ? tIndex : 0, 0);
    push(0x2C); word(x0); word(y0); word(w); word(h); push(0);
    const minCode = Math.max(2, bitsPerPixel);
    push(minCode);
    const lz = lzwEncode(data, minCode);
    for (let i = 0; i < lz.length; i += 255) { const n = Math.min(255, lz.length - i); push(n); for (let k = 0; k < n; k++) out.push(lz[i + k]); }
    push(0);
    prev = fr.indices;
  }
  push(0x3B);
  return Uint8Array.from(out);
}

export function toBase64(bytes) {
  let s = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

/* ------------------------------------------------------------------ the whole job */

/**
 * @param {Uint8Array} bytes  the GIF file
 * @param {{maxChars?:number}} opts
 * @returns {{dataUrl:string, frames:number, size:number, colors:number}|null}  null when it is a still picture
 * @throws Error when it cannot be made small enough
 */
export function compressGif(bytes, { maxChars = 40000, sizes = [72, 64, 56, 48, 40], colorSteps = [64, 48, 32, 24, 16], frameSteps = [24, 18, 12, 8, 5] } = {}) {
  // pass 1: read every frame once, shrunk to the largest size right away (full-size frames never pile up)
  const big = sizes[0];
  const first = [];
  let count = 0;
  const info = decodeGif(bytes, ({ rgba, delay, width, height }) => {
    count++;
    first.push({ px: squareDown(rgba, width, height, big), delay: delay || 100 });
  }, { maxFrames: 400 });
  if (count < 2) return null;
  for (const size of sizes) {
    const small = size === big ? first : first.map((f) => ({ px: squareDown(f.px, big, big, size, 3), delay: f.delay }));
    for (const maxFrames of frameSteps) {
      const picked = pickFrames(small, maxFrames);
      for (const colors of colorSteps) {
        const palette = buildPalette(picked.map((p) => p.px), colors);
        const cache = new Map();
        const frames = picked.map((p) => ({ indices: indexFrame(p.px, palette, cache), delay: p.delay }));
        const gif = encodeGif(frames, palette, size);
        const dataUrl = `data:image/gif;base64,${toBase64(gif)}`;
        if (dataUrl.length <= maxChars) return { dataUrl, frames: frames.length, size, colors: palette.length, source: info };
      }
    }
  }
  throw new Error('Could not shrink that GIF enough. Try a shorter or simpler one.');
}

/** Keeps at most `max` frames, merging the delay of dropped frames into the one kept before them. */
export function pickFrames(frames, max) {
  if (frames.length <= max) return frames.map((f) => ({ ...f }));
  const step = frames.length / max; const out = [];
  for (let i = 0; i < max; i++) {
    const a = Math.floor(i * step); const b = Math.floor((i + 1) * step);
    let delay = 0; for (let k = a; k < Math.max(b, a + 1); k++) delay += frames[k].delay;
    out.push({ px: frames[a].px, delay });
  }
  return out;
}

/** True when the first bytes say GIF. */
export function looksLikeGif(bytes) {
  return bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
}
