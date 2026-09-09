'use strict';

// Sprint 3, story C-1 — the only door to file storage (ADR-0002).
// Nothing outside this folder imports `fs` or an S3 SDK.

const config = require('../config');

/**
 * Storage driver interface:
 *   put(key, buffer, contentType) -> { key, size }
 *   get(key)                      -> Buffer
 *   remove(key)                   -> void   (idempotent — a missing file is not an error)
 *   exists(key)                   -> boolean
 */

let driver = null;

function storage() {
  if (!driver) {
    driver = config.storage.driver === 's3' ? require('./s3') : require('./local');
  }
  return driver;
}

/**
 * Canonical object key, shared by every driver so the local tree and an S3 bucket are
 * interchangeable. Date-prefixed so an S3 lifecycle rule can express the same 31-day
 * retention, scoped to one data type.
 *
 *   screenshots/<employeeId>/<YYYY-MM-DD>/<uuid>.jpg
 */
function buildKey({ type, employeeId, date, id, extension }) {
  return `${type}/${employeeId}/${date}/${id}.${extension}`;
}

const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

function extensionFor(contentType, fallback) {
  return EXTENSION_BY_TYPE[contentType] || fallback;
}

module.exports = { storage, buildKey, extensionFor, EXTENSION_BY_TYPE };
