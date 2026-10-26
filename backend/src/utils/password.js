'use strict';

const crypto = require('crypto');

// No 0/O, 1/l/I: a password read out of a WhatsApp message and typed in by hand must survive
// that. 54 characters over 12 places is far beyond what an online guess can reach, and it is
// only ever a temporary password the person replaces at first sign-in.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A readable one-time password such as `Kd7p-Wm3x-Qz9n`, from a cryptographic source. */
function generateTemporaryPassword() {
  const groups = [];
  for (let g = 0; g < 3; g += 1) {
    let group = '';
    for (let i = 0; i < 4; i += 1) group += ALPHABET[crypto.randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

module.exports = { generateTemporaryPassword };
