// Draws the extension icons (cardinal tile, gold calendar with a checked slot) as PNGs.
// Run with `npm run icons`; output is committed under public/icons.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zlibSync } from "fflate";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const CARDINAL = [153, 0, 0];
const GOLD = [255, 204, 0];
const WHITE = [255, 255, 255];

function roundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour at a point in unit coordinates (0..1), or null for transparent. */
function shade(x, y) {
  if (!roundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) return null;
  // calendar body
  const inCal = roundRect(x, y, 0.2, 0.26, 0.8, 0.8, 0.07);
  if (inCal) {
    if (y < 0.4) return GOLD; // header band
    // grid cells: 3 columns x 2 rows, one highlighted
    const gx = (x - 0.27) / 0.155;
    const gy = (y - 0.46) / 0.155;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    if (ix >= 0 && ix < 3 && iy >= 0 && iy < 2 && gx - ix < 0.78 && gy - iy < 0.78) return ix === 1 && iy === 0 ? CARDINAL : GOLD;
    return WHITE;
  }
  // binder rings
  if (roundRect(x, y, 0.33, 0.18, 0.39, 0.33, 0.03) || roundRect(x, y, 0.61, 0.18, 0.67, 0.33, 0.03)) return GOLD;
  return CARDINAL;
}

function render(size) {
  const ss = 4;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(size, rgba) {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size); v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size, render(size)));
  console.log(`icons/icon-${size}.png`);
}
