'use strict';

const { badRequest } = require('../utils/errors');

/**
 * Validates and *replaces* the given request part with the parsed result, so handlers work
 * with coerced, trimmed, known-shaped data and never re-check types.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} part
 */
function validate(schema, part = 'body') {
  return function run(req, res, next) {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || part,
        message: i.message,
      }));
      return next(badRequest(`Invalid request ${part}`, details));
    }
    // Express 5 makes req.query a getter; assigning to a local property is the portable path.
    if (part === 'query') {
      req.validatedQuery = result.data;
    } else {
      req[part] = result.data;
    }
    return next();
  };
}

/** Reads whichever query object validate() populated, so handlers do not care about Express version. */
function q(req) {
  return req.validatedQuery || req.query;
}

module.exports = { validate, q };
