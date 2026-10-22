'use strict';

// Generates build/icon.png — the one source icon electron-builder converts into every
// platform's format (.ico for Windows, .icns for macOS, straight PNG for Linux) when pointed
// at it via the `icon` key in electron-builder.yml. No image library, no ImageMagick: the same
// hand-rolled PNG encoder used for the tray icons and the seed screenshots.
//
// Design: a rounded square in the brand accent colour with a centred white disc — the same
// visual language as the tray icons (trayIcon.js) and the web portal's brand mark, at a
// resolution (1024x1024) that scales cleanly down to every size electron-builder needs.
// This is a placeholder, not a final asset: replace this file with a real logo whenever one
// exists and re-run `npm run icon`, or overwrite build/icon.png directly.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

/** Distance from a point to the nearest edge of a rounded square, negative when inside. */
function roundedSquareDistance(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - cx, y - cy) - radius;
}

function generateIconPng(size = 1024) {
  const accent = [47, 92, 255]; // matches --accent in the web portal's globals.css
  const radius = size * 0.22;
  const dotRadius = size * 0.24;
  const cx = size / 2;
  const cy = size / 2;

  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: None

    for (let x = 0; x < size; x += 1) {
      // Antialias both edges over ~1.5px so the icon has a clean edge at every scale
      // electron-builder resamples it to, down to 16x16.
      const squareEdge = roundedSquareDistance(x + 0.5, y + 0.5, size, radius);
      const squareAlpha = clamp01(0.5 - squareEdge / 1.5);

      let rgb = accent;
      let alpha = squareAlpha;

      if (squareAlpha > 0) {
        const dotDistance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - dotRadius;
        const dotAlpha = clamp01(0.5 - dotDistance / 1.5);
        if (dotAlpha > 0) {
          rgb = [255, 255, 255];
          alpha = squareAlpha * dotAlpha + squareAlpha * (1 - dotAlpha); // dot blended onto the square
          // Blend white over the accent square by dotAlpha specifically, not a flat override,
          // so the disc's own edge antialiases against the blue rather than against transparency.
          const blended = mix(accent, [255, 255, 255], dotAlpha);
          rgb = blended;
        }
      }

      const i = rowStart + 1 + x * 4;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
      raw[i + 3] = Math.round(255 * alpha);
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

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round);
}

function main() {
  const outPath = path.join(__dirname, 'icon.png');
  fs.writeFileSync(outPath, generateIconPng(1024));
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) main();

module.exports = { generateIconPng };
