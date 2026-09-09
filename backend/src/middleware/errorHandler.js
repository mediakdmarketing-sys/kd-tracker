'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

/**
 * body-parser rejects an oversized or malformed body before any route runs. Those are client
 * errors, not server faults, so they are translated rather than reported as 500s.
 */
function translateBodyParserError(err) {
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is larger than the upload limit');
  }
  if (err.type === 'entity.parse.failed') {
    return new ApiError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
  }
  return err;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(rawError, req, res, next) {
  const err = translateBodyParserError(rawError);
  const isExpected = err instanceof ApiError || err.expected === true;
  const status = isExpected ? err.status : 500;

  if (!isExpected) {
    // Unexpected: log the whole thing server-side, tell the client nothing about internals.
    logger.error('Unhandled error', {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id,
      message: err.message,
      stack: err.stack,
    });
  } else if (status >= 500) {
    logger.error(err.message, { code: err.code, path: req.originalUrl });
  }

  const body = {
    error: {
      code: isExpected ? err.code : 'INTERNAL_ERROR',
      message: isExpected ? err.message : 'Something went wrong on our end',
    },
  };
  if (isExpected && err.details) body.error.details = err.details;
  if (!isExpected && !config.isProd) body.error.debug = err.message;

  res.status(status).json(body);
}

module.exports = { errorHandler, notFoundHandler };
