'use strict';

const VERSION = /^\d+(\.\d+){1,3}$/;

const isVersion = (v) => typeof v === 'string' && VERSION.test(v);

/** Negative, zero or positive, comparing dotted numbers ("0.7.10" is newer than "0.7.9"). */
function compare(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = { isVersion, compare };
