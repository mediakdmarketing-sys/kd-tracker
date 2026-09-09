'use strict';

// Tray icons, generated rather than shipped as files.
//
// The icon is the only thing most employees will ever see of this agent, and it has to say
// truthfully what is happening: capturing, on a break, offline with a backlog. Drawing four
// tiny discs in code keeps them in step with the states in one place, and avoids binary
// assets that drift out of sync with the code that picks between them.

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

const COLOURS = {
  off: [140, 148, 163], // signed out or punched out
  working: [18, 128, 92],
  break: [164, 97, 10],
  offline: [180, 35, 31], // queue is backing up
};

const cache = new Map();

function iconFor(state) {
  if (!cache.has(state)) {
    cache.set(state, nativeImage.createFromBuffer(discPng(COLOURS[state] || COLOURS.off)));
  }
  return cache.get(state);
}

module.exports = { iconFor, discPng };
