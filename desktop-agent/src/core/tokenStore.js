'use strict';

// Where the agent keeps its session between restarts.
//
// A refresh token is valid for 14 days, so a plain-text file on a shared or stolen laptop is a
// standing session for anyone who finds it. Electron's `safeStorage` binds encryption to the
// OS keychain/DPAPI; the cipher is injected so this module stays testable in plain Node and so
// a platform without a working keychain degrades to plain text *loudly* rather than silently.

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class FileTokenStore {
  /**
   * @param {string} filePath
   * @param {object} [cipher]  { available(), encrypt(string) -> Buffer, decrypt(Buffer) -> string }
   */
  constructor(filePath, cipher = null) {
    this.filePath = filePath;
    this.cipher = cipher;
    this.cache = undefined;

    if (!cipher?.available?.()) {
      logger.warn(
        'OS-backed encryption is not available; session tokens will be stored in plain text',
        { path: filePath }
      );
    }
  }

  load() {
    if (this.cache !== undefined) return this.cache;

    try {
      const raw = fs.readFileSync(this.filePath);
      const encrypted = raw[0] === 0x01; // 1-byte header: encrypted or not
      const json = encrypted
        ? this.cipher.decrypt(raw.subarray(1))
        : raw.subarray(1).toString('utf8');
      this.cache = JSON.parse(json);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // A corrupt or undecryptable file means the session is gone, not that the agent
        // should crash on every start.
        logger.warn('Could not read stored session; sign-in required', { message: err.message });
      }
      this.cache = null;
    }

    return this.cache;
  }

  save(tokens) {
    const json = JSON.stringify(tokens);
    const usable = this.cipher?.available?.();
    const body = usable ? this.cipher.encrypt(json) : Buffer.from(json, 'utf8');

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, Buffer.concat([Buffer.from([usable ? 1 : 0]), body]), {
      mode: 0o600,
    });
    this.cache = tokens;
  }

  clear() {
    try {
      fs.unlinkSync(this.filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.cache = null;
  }
}

/** In-memory store, for tests. */
class MemoryTokenStore {
  constructor(initial = null) {
    this.tokens = initial;
  }

  load() {
    return this.tokens;
  }

  save(tokens) {
    this.tokens = tokens;
  }

  clear() {
    this.tokens = null;
  }
}

module.exports = { FileTokenStore, MemoryTokenStore };
