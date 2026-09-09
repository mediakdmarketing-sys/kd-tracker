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

module.exports = { asyncHandler, toBool, toIso, pagination, paged };
