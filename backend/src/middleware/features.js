'use strict';

const { featureDisabled } = require('../utils/errors');

// What a person is told when a feature is off for their company.
const LABEL = {
  screenCapture: 'Screen capture',
  audioCapture: 'Microphone recording',
  idleTracking: 'Idle time tracking',
  payroll: 'Payroll',
  leave: 'Leave',
};

/**
 * Reads and pages of a feature the company does not have answer 403 FEATURE_DISABLED. Must come
 * after `authenticate`, which loads the company's features onto req.user.
 */
function requireFeature(name) {
  return function guard(req, res, next) {
    if (req.user && req.user.features && req.user.features[name]) return next();
    return next(featureDisabled(LABEL[name] || name));
  };
}

/**
 * Uploads from an agent are answered 200 and dropped when the feature is off, rather than refused:
 * an agent that has not yet learned the feature is off (an older build, a status poll not yet
 * made) must not treat it as a failure and keep retrying or queueing the same upload.
 */
function ignoreWhenDisabled(name) {
  return function guard(req, res, next) {
    if (req.user && req.user.features && req.user.features[name]) return next();
    return res.status(200).json({ ignored: true, reason: 'FEATURE_DISABLED', feature: name });
  };
}

module.exports = { requireFeature, ignoreWhenDisabled };
