'use strict';

const { z } = require('zod');
const { badRequest } = require('../../utils/errors');

// What can be changed in a company's operational settings, shared by the HR Settings page and the
// platform owner's per-company defaults.
const settingsPatchSchema = z.object({
  capture: z
    .object({
      screenshotMinIntervalSec: z.number().int().min(30).max(3600).optional(),
      screenshotMaxIntervalSec: z.number().int().min(30).max(3600).optional(),
      audioSampleDurationSec: z.number().int().min(10).max(1800).optional(),
      audioSampleGapSec: z.number().int().min(10).max(3600).optional(),
    })
    .optional(),
  shift: z
    .object({
      targetSeconds: z.number().int().min(1800).max(57600).optional(),
      breakAllowanceSeconds: z.number().int().min(0).max(14400).optional(),
      idleThresholdSeconds: z.number().int().min(60).max(3600).optional(),
      autoCloseHours: z.number().int().min(1).max(48).optional(),
      halfDaySeconds: z.number().int().min(900).max(43200).optional(),
      fullDaySeconds: z.number().int().min(900).max(57600).optional(),
    })
    .optional(),
  retention: z.object({ days: z.number().int().min(1).max(365).optional() }).optional(),
  payroll: z.object({ deductIdle: z.boolean().optional() }).optional(),
});

/**
 * Checks what a single field cannot: the values taken together, once the patch is merged onto
 * what is not being changed. Throws a 400 if they contradict each other.
 */
function assertValidSettings(current, patch) {
  const merged = {
    capture: { ...current.capture, ...patch.capture },
    shift: { ...current.shift, ...patch.shift },
    retention: { ...current.retention, ...patch.retention },
    payroll: { ...current.payroll, ...patch.payroll },
  };
  if (merged.shift.halfDaySeconds > merged.shift.fullDaySeconds) {
    throw badRequest('A half day cannot need more hours than a full day');
  }
  if (merged.capture.screenshotMinIntervalSec > merged.capture.screenshotMaxIntervalSec) {
    throw badRequest('Screenshot minimum interval must not exceed the maximum interval');
  }
}

module.exports = { settingsPatchSchema, assertValidSettings };
