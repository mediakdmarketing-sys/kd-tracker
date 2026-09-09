#!/usr/bin/env node
// Generates PWA icons (192x192 and 512x512) as PNG files.
// Uses only built-in Node.js — no canvas library needed.
// Produces a simple filled-circle logo with "KD" text as an SVG,
// then writes minimal valid PNG files using raw PNG encoding.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// --- Minimal PNG encoder ---------------------------------------------------
function crc32(buf) {
  let crc = 0xffffffff;
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size) {
  // Draw each pixel: blue circle on light-grey background, "KD" approximated with pixels.
  const ACCENT = [0x2f, 0x5c, 0xff]; // #2f5cff
  const BG     = [0xf6, 0xf7, 0xf9]; // #f6f7f9
  const TEXT   = [0xff, 0xff, 0xff]; // white

  const pixels = [];
  const cx = size / 2, cy = size / 2, r = size * 0.42;

  // Simple "KD" bitmap glyph scaled to icon size.
  // We render it as white text on the blue circle using a bitmask approach.
  function inCircle(x, y) {
    return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
  }

  // Scale factor: letter glyphs are defined on a 10x7 grid, scaled to ~35% of icon.
  const glyphH = Math.round(size * 0.35);
  const glyphW = Math.round(glyphH * 0.7);
  const gTop   = Math.round(cy - glyphH / 2);
  const gLeft  = Math.round(cx - glyphW * 1.1); // left letter starts here

  // 5x7 pixel font bitmasks for K and D
  const K = [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001];
  const D = [0b11100,0b10010,0b10001,0b10001,0b10001,0b10010,0b11100];

  function glyphPixel(letter, px, py) {
    const col = Math.floor((px - gLeft) / (glyphW / 5));
    const row = Math.floor((py - gTop)  / (glyphH / 7));
    if (col < 0 || col >= 5 || row < 0 || row >= 7) return false;
    const mask = letter === 'K' ? K[row] : D[row];
    return Boolean(mask & (1 << (4 - col)));
  }

  const gap = Math.round(glyphW * 0.15);

  for (let y = 0; y < size; y++) {
    // PNG filter byte (none = 0) per row
    const row = [0];
    for (let x = 0; x < size; x++) {
      const inK = glyphPixel('K', x, y);
      const inD = glyphPixel('D', x + Math.round(-(glyphW + gap)), y);
      // shift D to the right of K
      const inK2 = x >= gLeft && x < gLeft + glyphW ? inK : false;
      const dLeft = gLeft + glyphW + gap;
      const inD2 = x >= dLeft
        ? glyphPixel('D', x - (dLeft - gLeft), y)
        : false;

      let px;
      if (!inCircle(x, y)) {
        px = BG;
      } else if (inK2 || inD2) {
        px = TEXT;
      } else {
        px = ACCENT;
      }
      row.push(...px, 255); // RGBA
    }
    pixels.push(...row);
  }

  const rawData = Buffer.from(pixels);
  const compressed = zlib.deflateSync(rawData, { level: 6 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const buf = makePng(size);
  const dest = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(dest, buf);
  console.log(`Written ${dest} (${buf.length} bytes)`);
}
console.log('Icons generated.');
