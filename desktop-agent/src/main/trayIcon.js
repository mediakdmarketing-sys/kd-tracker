'use strict';

// Tray icons: the WorkBuddy logo with a status dot, generated from one logo file.
//
// The icon is the only thing most employees will ever see of this agent, and it has to say
// truthfully what is happening: capturing, on a break, offline with a backlog. The logo says
// which app this is; the dot in the corner says what it is doing. Painting the dot in code keeps
// all four states in step in one place instead of four binary assets drifting out of sync with
// the code that picks between them.

const path = require('path');
const zlib = require('zlib');
const { nativeImage } = require('electron');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A filled disc on a transparent square, as an RGBA PNG. */
function discPng(rgb, size = 16) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const centre = (size - 1) / 2;
  const radius = size * 0.42;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: None

    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      // One pixel of feathering, so the disc does not look jagged on a menu bar.
      const alpha = Math.round(255 * Math.max(0, Math.min(1, radius - distance)));
      const i = rowStart + 1 + x * 4;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
      raw[i + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Status colours. Slightly brighter than a UI palette because the dot is only a few pixels
// wide on a taskbar that can be light or dark.
const COLOURS = {
  off: [140, 148, 163], // signed out or punched out
  working: [22, 163, 74],
  break: [217, 119, 6],
  offline: [220, 38, 38], // queue is backing up
};

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');

// Drawn at 32px and tagged as 2x, so it is sharp at 16 logical pixels on a high-DPI taskbar and
// still acceptable on a standard one.
const SIZE = 32;
const DOT = { cx: 23, cy: 23, radius: 7.5, ring: 9.5 };

let rgbaOrder = null;

/**
 * Whether this platform's raw bitmaps are RGBA or BGRA. Skia picks per platform, and getting it
 * wrong swaps red and blue — green would show as green but amber as blue-ish. Detected by
 * decoding a known red pixel rather than assuming from process.platform.
 */
function bitmapIsRgba() {
  if (rgbaOrder === null) {
    const probe = nativeImage.createFromBuffer(discPng([255, 0, 0], 16)).toBitmap();
    const centre = (8 * 16 + 8) * 4;
    rgbaOrder = probe[centre] === 255;
  }
  return rgbaOrder;
}

/** Composites the status dot (with a white ring for contrast) onto a raw 32x32 bitmap. */
function paintDot(bitmap, rgb) {
  const rgba = bitmapIsRgba();
  const [r, g, b] = rgba ? rgb : [rgb[2], rgb[1], rgb[0]];

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d = Math.hypot(x - DOT.cx, y - DOT.cy);
      const ringCover = Math.max(0, Math.min(1, DOT.ring - d));
      if (ringCover === 0) continue;
      const dotCover = Math.max(0, Math.min(1, DOT.radius - d));

      const i = (y * SIZE + x) * 4;
      // Ring first (white), then the coloured dot over it. Premultiplied "over" compositing.
      const ringA = ringCover;
      for (let c = 0; c < 3; c += 1) bitmap[i + c] = Math.round(255 * ringA + bitmap[i + c] * (1 - ringA));
      bitmap[i + 3] = Math.round(255 * ringA + bitmap[i + 3] * (1 - ringA));

      if (dotCover > 0) {
        const src = [r, g, b];
        for (let c = 0; c < 3; c += 1) bitmap[i + c] = Math.round(src[c] * dotCover + bitmap[i + c] * (1 - dotCover));
        bitmap[i + 3] = Math.round(255 * dotCover + bitmap[i + 3] * (1 - dotCover));
      }
    }
  }
}

function logoWithDot(rgb) {
  const logo = nativeImage.createFromPath(LOGO_PATH);
  // No logo file (or unreadable): fall back to the plain status disc rather than a blank icon.
  if (logo.isEmpty()) return nativeImage.createFromBuffer(discPng(rgb));

  const small = logo.resize({ width: SIZE, height: SIZE, quality: 'best' });
  const bitmap = Buffer.from(small.toBitmap());
  paintDot(bitmap, rgb);
  return nativeImage.createFromBitmap(bitmap, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

const cache = new Map();

function iconFor(state) {
  if (!cache.has(state)) cache.set(state, logoWithDot(COLOURS[state] || COLOURS.off));
  return cache.get(state);
}

module.exports = { iconFor, discPng };
