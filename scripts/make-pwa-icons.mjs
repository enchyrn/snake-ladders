#!/usr/bin/env node
// Generates the PWA home-screen icons from scratch, redrawing the same motif
// as src-tauri/icons/icon.png (dark teal rounded square, cream ladder,
// green snake) at each size the manifest needs. We redraw instead of
// decoding/downscaling the source PNG because the maskable variant needs the
// motif deliberately shrunk into a safe zone with the background bled to the
// edges — a different composition, not just a resize — and box-filtering a
// 1024x1024 raster down to 192px by hand is more code than drawing four
// simple shapes at the sizes we actually need.
//
// Plain Node ESM, no dependencies: PNG encoding is just zlib (for DEFLATE
// and CRC32) plus hand-written IHDR/IDAT/IEND chunks.

import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Older Node builds don't export zlib.crc32 (added in Node 21.x/20.12+); the
// engine range here targets 22, but fall back to a table-based CRC32 rather
// than assume.
const crc32Bytes =
  typeof crc32 === "function" ? (buf) => crc32(buf) >>> 0 : crc32Fallback();

function crc32Fallback() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
}

// Palette matched to src/render/palette.ts (boardDark/boardEdge for the
// square, ladder/ladderDark for the rungs, snake/snakeDark/snakeHead for the
// body) so the app icon and the in-game board read as the same object.
const COLORS = {
  boardDark: [0x17, 0x2b, 0x36],
  boardEdge: [0x0b, 0x14, 0x19],
  ladder: [0xe8, 0xd6, 0xa0],
  ladderDark: [0xb9, 0xa3, 0x6f],
  snake: [0x2f, 0x8f, 0x5b],
  snakeDark: [0x1d, 0x5c, 0x3a],
  snakeHead: [0x48, 0xc0, 0x7c],
};

function makePixelBuffer(size) {
  // RGBA, row-major, filled transparent so callers can choose whether to
  // paint a background (maskable/opaque targets) or leave edges transparent
  // (the standard "any" icons, which the OS itself rounds/masks).
  return new Uint8ClampedArray(size * size * 4);
}

function setPixel(px, size, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

function fillRoundedSquare(px, size, radius, color) {
  const r = radius;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRoundedSquare(x, y, size, r)) setPixel(px, size, x, y, color);
    }
  }
}

function insideRoundedSquare(x, y, size, r) {
  const cx = x < r ? r : x > size - 1 - r ? size - 1 - r : x;
  const cy = y < r ? r : y > size - 1 - r ? size - 1 - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Distance from point (x,y) to the segment (x1,y1)-(x2,y2), for drawing the
// ladder rails/rungs and the snake's body as thick strokes.
function distToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const ex = x - px;
  const ey = y - py;
  return Math.sqrt(ex * ex + ey * ey);
}

function strokeSegment(px, size, x1, y1, x2, y2, width, color, clip) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - width));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + width));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - width));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + width));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (clip && !clip(x, y)) continue;
      if (distToSegment(x, y, x1, y1, x2, y2) <= width / 2) {
        setPixel(px, size, x, y, color);
      }
    }
  }
}

// Draws the ladder-crossed-by-snake motif inside the square [ox,oy, ox+d,oy+d).
function drawMotif(px, size, ox, oy, d, clip) {
  const railWidth = d * 0.09;
  const rungWidth = d * 0.075;
  const railInset = d * 0.22;
  const x1 = ox + railInset;
  const x2 = ox + d - railInset;
  const yTop = oy + d * 0.12;
  const yBottom = oy + d * 0.88;

  // Ladder: two parallel rails, diagonal like the source icon.
  strokeSegment(px, size, x1, yTop, x1 + d * 0.12, yBottom, railWidth, COLORS.ladderDark, clip);
  strokeSegment(px, size, x2, yTop, x2 + d * 0.12, yBottom, railWidth, COLORS.ladderDark, clip);
  const rungCount = 5;
  for (let i = 0; i < rungCount; i++) {
    const t = i / (rungCount - 1);
    const ry = yTop + t * (yBottom - yTop);
    const rx1 = x1 + t * d * 0.12;
    const rx2 = x2 + t * d * 0.12;
    strokeSegment(px, size, rx1, ry, rx2, ry, rungWidth, COLORS.ladder, clip);
  }

  // Snake: a wavy stroke crossing the ladder, thicker at the head.
  const snakeWidth = d * 0.1;
  const cy = oy + d * 0.5;
  const points = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = ox + d * 0.08 + t * d * 0.84;
    const sy = cy + Math.sin(t * Math.PI * 1.6) * d * 0.22;
    points.push([sx, sy]);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const isHead = i >= points.length - 3;
    strokeSegment(
      px,
      size,
      points[i][0],
      points[i][1],
      points[i + 1][0],
      points[i + 1][1],
      isHead ? snakeWidth * 1.35 : snakeWidth,
      isHead ? COLORS.snakeHead : COLORS.snake,
      clip,
    );
  }
}

function drawStandardIcon(size) {
  const px = makePixelBuffer(size);
  const radius = size * 0.22;
  fillRoundedSquare(px, size, radius, COLORS.boardDark);
  const clip = (x, y) => insideRoundedSquare(x, y, size, radius);
  drawMotif(px, size, size * 0.08, size * 0.08, size * 0.84, clip);
  return px;
}

// Maskable icons are cropped by the OS to arbitrary shapes (circle, squircle,
// ...); only the inner ~80% "safe zone" circle is guaranteed visible, and the
// background must fill the full square so no shape crop reveals transparency.
function drawMaskableIcon(size) {
  const px = makePixelBuffer(size);
  // No rounding here — the background must reach all four edges untouched;
  // the OS supplies whatever corner/shape mask it wants.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) setPixel(px, size, x, y, COLORS.boardEdge);
  }
  const safeRadius = size * 0.4; // 80% of size, as a radius it's 0.4*size
  const cx = size / 2;
  const cy = size / 2;
  const clip = (x, y) => insideCircle(x, y, cx, cy, safeRadius);
  const motifSize = safeRadius * 2 * 0.86; // small margin inside the safe circle
  const motifOrigin = size / 2 - motifSize / 2;
  drawMotif(px, size, motifOrigin, motifOrigin, motifSize, clip);
  return px;
}

// iOS applies its own rounded-rect mask and renders a transparent source
// icon with black showing through the corners, so apple-touch-icon must be
// fully opaque with square corners — no clipping, no alpha.
function drawAppleTouchIcon(size) {
  const px = makePixelBuffer(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) setPixel(px, size, x, y, COLORS.boardDark);
  }
  drawMotif(px, size, size * 0.08, size * 0.08, size * 0.84, null);
  return px;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32Bytes(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(px, size) {
  // Colour type 6 = RGBA, bit depth 8. Each scanline is prefixed with a
  // filter-type byte; filter 0 (None) keeps this simple since these icons
  // are small enough that DEFLATE alone compresses the flat regions well.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < stride; x++) {
      raw[rowStart + 1 + x] = px[y * stride + x];
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeIcon(path, px, size) {
  const png = encodePNG(px, size);
  writeFileSync(path, png);
  console.log(`  ${path} (${size}x${size}, ${png.length} bytes)`);
}

const outDir = resolve("public");
mkdirSync(outDir, { recursive: true });

console.log("Generating PWA icons:");
writeIcon(resolve(outDir, "pwa-192.png"), drawStandardIcon(192), 192);
writeIcon(resolve(outDir, "pwa-512.png"), drawStandardIcon(512), 512);
writeIcon(resolve(outDir, "pwa-maskable-512.png"), drawMaskableIcon(512), 512);
writeIcon(resolve(outDir, "apple-touch-icon.png"), drawAppleTouchIcon(180), 180);
