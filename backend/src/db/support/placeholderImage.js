'use strict';

// Minimal PNG encoder for seed data.
//
// The demo needs screenshot files that a browser will actually render — a 1-pixel placeholder
// shows up as a broken image in the admin viewer, which makes the page impossible to review.
// Rather than adding an image library as a production dependency for seed data only, this
// writes a valid PNG by hand: signature, IHDR, one deflated IDAT, IEND.

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

/**
 * A flat mock of a desktop window: title bar, a couple of panels, some "text" rows. Enough
 * that the screenshot grid in the admin portal looks like screenshots rather than swatches.
 *
 * @param {number} variant  changes the accent colour so consecutive captures differ
 */
function makePlaceholderPng(variant = 0, width = 320, height = 200) {
  const accents = [
    [47, 92, 255],
    [18, 128, 92],
    [164, 97, 10],
    [107, 91, 210],
    [180, 35, 31],
  ];
  const accent = accents[variant % accents.length];

  const raw = Buffer.alloc(height * (width * 3 + 1));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter type: None

    for (let x = 0; x < width; x += 1) {
      let rgb;

      if (y < 22) {
        rgb = accent; // title bar
      } else if (y < 26) {
        rgb = [210, 214, 222]; // divider
      } else if (x < 78) {
        rgb = [232, 235, 240]; // sidebar
      } else {
        rgb = [250, 251, 253]; // content
      }

      // "Text" rows in the content area.
      if (y > 40 && x > 92 && x < width - 20) {
        const line = Math.floor((y - 40) / 16);
        const inLine = (y - 40) % 16 < 7;
        const lineWidth = width - 40 - ((line * 37) % 90);
        if (inLine && x < lineWidth && line < 8) rgb = [205, 210, 219];
      }

      // Sidebar items.
      if (x > 8 && x < 68 && y > 36 && (y - 36) % 22 < 9) rgb = [214, 219, 227];

      const i = rowStart + 1 + x * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { makePlaceholderPng };
