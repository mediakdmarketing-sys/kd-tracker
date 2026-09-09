'use strict';

/**
 * Errors thrown with ApiError reach the client as a clean JSON body. Anything else is a bug
 * and is reported as a 500 with no internals leaked (see middleware/errorHandler).
 */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
  }
}

const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have access to this resource') =>
  new ApiError(403, 'FORBIDDEN', message);
/**
 * Distinct from plain `forbidden()`: this means the *account* is dead, not just this one
 * action. A client — the desktop agent especially — needs to tell the two apart. Generic
 * FORBIDDEN (e.g. audio consent withdrawn) rejects one request; ACCOUNT_DEACTIVATED means
 * every future request on this token will fail the same way until HR reactivates it, so the
 * agent should stop pretending it is signed in rather than abandoning queued work item by item.
 */
const accountDeactivated = (message = 'Account is deactivated') =>
  new ApiError(403, 'ACCOUNT_DEACTIVATED', message);
const notFound = (message = 'Not found') => new ApiError(404, 'NOT_FOUND', message);
/** 409: the request was well-formed but the current state does not allow it. */
const conflict = (message, details) => new ApiError(409, 'CONFLICT', message, details);
const payloadTooLarge = (message) => new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
const notImplemented = (message) => new ApiError(501, 'NOT_IMPLEMENTED', message);

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  accountDeactivated,
  notFound,
  conflict,
  payloadTooLarge,
  notImplemented,
};
