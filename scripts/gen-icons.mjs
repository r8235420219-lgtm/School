// scripts/gen-icons.mjs — generate PWA PNG icons without any image library.
// Draws a gradient rounded-square with a white "open book" mark, then hand-encodes PNG.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

function lerp(a, b, t) { return a + (b - a) * t; }
const C1 = [0x63, 0x66, 0xf1]; // indigo
const C2 = [0x22, 0xd3, 0xee]; // cyan
const WHITE = [0xff, 0xff, 0xff];
const BG = [0x0f, 0x12, 0x20];

// Rounded-rectangle membership with soft (antialiased) edge.
function roundRectAlpha(x, y, x0, y0, x1, y1, r) {
  if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) return 0;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, r - dist + 0.5)); // 1px soft edge
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const R = size * 0.22;          // corner radius of the tile
  // Book geometry (relative to size)
  const bookAlpha = (x, y) => {
    const lp = roundRectAlpha(x, y, size * 0.20, size * 0.31, size * 0.485, size * 0.71, size * 0.03);
    const rp = roundRectAlpha(x, y, size * 0.515, size * 0.31, size * 0.80, size * 0.71, size * 0.03);
    return Math.max(lp, rp);
  };
  // Faint "text lines" on the pages
  const lineAlpha = (x, y) => {
    let a = 0;
    for (let i = 0; i < 3; i++) {
      const ly = size * (0.40 + i * 0.10);
      const onLine = Math.abs(y - ly) < size * 0.012;
      if (!onLine) continue;
      const left = x > size * 0.24 && x < size * 0.45;
      const right = x > size * 0.55 && x < size * 0.76;
      if (left || right) a = 1;
    }
    return a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);        // diagonal gradient
      let r = lerp(C1[0], C2[0], t);
      let g = lerp(C1[1], C2[1], t);
      let b = lerp(C1[2], C2[2], t);

      // Book (white) over gradient
      const ba = bookAlpha(x, y);
      if (ba > 0) {
        r = lerp(r, WHITE[0], ba);
        g = lerp(g, WHITE[1], ba);
        b = lerp(b, WHITE[2], ba);
        // subtle indigo text lines
        const la = lineAlpha(x, y);
        if (la > 0) { r = lerp(r, C1[0], 0.35); g = lerp(g, C1[1], 0.35); b = lerp(b, C1[2], 0.35); }
      }

      // Rounded-tile alpha: outside the rounded square fades to app bg (opaque, so maskable is safe)
      const tileA = roundRectAlpha(x, y, 0, 0, size - 1, size - 1, R);
      r = lerp(BG[0], r, tileA);
      g = lerp(BG[1], g, tileA);
      b = lerp(BG[2], b, tileA);

      const o = (y * size + x) * 4;
      buf[o] = r & 0xff; buf[o + 1] = g & 0xff; buf[o + 2] = b & 0xff; buf[o + 3] = 0xff;
    }
  }
  return buf;
}

function encodePng(rgba, size) {
  // Prepend filter byte (0) to each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const rgba = drawIcon(size);
  const png = encodePng(rgba, size);
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
