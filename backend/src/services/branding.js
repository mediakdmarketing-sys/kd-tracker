'use strict';

// The company logo: one image, kept in file storage, remembered in the settings row.

const settings = require('./settings');
const { storage } = require('../storage');
const { badRequest } = require('../utils/errors');
const t = require('../utils/time');

const MAX_BYTES = 1024 * 1024; // 1 MB is far more than a logo needs
// SVG is left out on purpose: it can carry scripts, and this file is served to browsers.
const TYPES = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: null }, // "RIFF....WEBP", checked below
};

function looksLike(type, buffer) {
  if (type === 'image/webp') {
    return buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return TYPES[type].magic.every((byte, i) => buffer[i] === byte);
}

/**
 * Saves a new logo, replacing the old one. The type must be one we accept AND the bytes must really
 * be that kind of image, so a renamed file cannot be served back to browsers under a false type.
 */
async function setLogo({ contentType, dataBase64, updatedBy }) {
  const spec = TYPES[contentType];
  if (!spec) throw badRequest('The logo must be a PNG, JPEG or WebP image');

  const buffer = Buffer.from(String(dataBase64 || ''), 'base64');
  if (!buffer.length) throw badRequest('The image is empty');
  if (buffer.length > MAX_BYTES) throw badRequest('The logo must be 1 MB or smaller');
  if (!looksLike(contentType, buffer)) throw badRequest(`That file is not a real ${spec.ext.toUpperCase()} image`);

  const previous = settings.get().company.logoKey;
  const now = t.now();
  // A new key each time, so a browser or email client never shows a stale cached logo.
  const key = `branding/logo-${now}.${spec.ext}`;
  await storage().put(key, buffer, contentType);
  await settings.update(
    { company: { logoKey: key, logoContentType: contentType, logoUpdatedAt: now } },
    { updatedBy }
  );
  if (previous && previous !== key) await storage().remove(previous).catch(() => {});
  return { updatedAt: now };
}

async function removeLogo({ updatedBy }) {
  const previous = settings.get().company.logoKey;
  await settings.update({ company: { logoKey: null, logoContentType: null, logoUpdatedAt: null } }, { updatedBy });
  if (previous) await storage().remove(previous).catch(() => {});
}

/** @returns {Promise<{ buffer: Buffer, contentType: string, updatedAt: number }|null>} */
async function readLogo() {
  const { logoKey, logoContentType, logoUpdatedAt } = settings.get().company;
  if (!logoKey) return null;
  try {
    return { buffer: await storage().get(logoKey), contentType: logoContentType, updatedAt: logoUpdatedAt };
  } catch {
    // The file is gone (storage wiped, or a different disk): behave as if no logo was set.
    return null;
  }
}

module.exports = { setLogo, removeLogo, readLogo, MAX_BYTES };
