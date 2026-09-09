'use strict';

// Local-disk storage driver. Development and single-instance deployments only — see ADR-0002.

const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

const ROOT = config.storage.localDir;

/**
 * Resolve a key to an absolute path, refusing anything that escapes the storage root.
 * Keys are built by the application, but a traversal here would be a file-write primitive,
 * so it is checked rather than assumed.
 */
function resolveKey(key) {
  const target = path.resolve(ROOT, key);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (!target.startsWith(rootWithSep)) {
    throw new Error(`Refusing storage key outside the storage root: ${key}`);
  }
  return target;
}

async function put(key, buffer, contentType) {
  const target = resolveKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  // contentType is accepted so the local driver matches the S3 driver's interface, even
  // though the local filesystem does not store MIME metadata. The extension embedded in
  // the key (e.g. .jpg, .webm) carries the type for local development purposes.
  return { key, size: buffer.length, contentType: contentType || null };
}

async function get(key) {
  return fs.readFile(resolveKey(key));
}

async function remove(key) {
  try {
    await fs.unlink(resolveKey(key));
  } catch (err) {
    // Idempotent by contract: the purge job must be safe to re-run after a partial failure.
    if (err.code !== 'ENOENT') throw err;
  }
}

async function exists(key) {
  try {
    await fs.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

module.exports = { name: 'local', put, get, remove, exists };
