'use strict';

/**
 * Wraps an async route handler so a rejected promise reaches Express's error handler
 * instead of hanging the request.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** SQLite returns 0/1 for booleans, Postgres returns true/false. The API exposes neither. */
function toBool(value) {
  return value === true || value === 1 || value === '1' || value === 't';
}

/** Epoch ms -> ISO 8601 for JSON responses. Clients never see raw epoch numbers. */
function toIso(ms) {
  return ms === null || ms === undefined ? null : new Date(Number(ms)).toISOString();
}

/** Clamped pagination, so a client cannot ask for the whole table. */
function pagination(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { limit, page, offset: (page - 1) * limit };
}

function paged(rows, total, { page, limit }) {
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * Serves an in-memory buffer with HTTP Range support (RFC 7233).
 *
 * Screenshots are viewed whole, but audio samples are scrubbed — without Range/206 support
 * a browser's <audio> element can still play a file start-to-finish, but seeking is unreliable
 * or silently broken in several browsers, since there is no way to fetch just the bytes after
 * the point the listener dragged to. The whole file is already read into memory by
 * capture.service's readFile(), so this is a slice, not a re-read.
 */
function sendWithRange(req, res, buffer, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    res.setHeader('Content-Range', `bytes */${buffer.length}`);
    return res.status(416).end();
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : buffer.length - Number.parseInt(match[2], 10);
  let end = match[1] && match[2] ? Number.parseInt(match[2], 10) : buffer.length - 1;
  start = Math.max(0, start);
  end = Math.min(buffer.length - 1, end);

  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    res.setHeader('Content-Range', `bytes */${buffer.length}`);
    return res.status(416).end();
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
  res.setHeader('Content-Length', end - start + 1);
  res.send(buffer.subarray(start, end + 1));
}

module.exports = { asyncHandler, toBool, toIso, pagination, paged, sendWithRange };
