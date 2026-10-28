'use strict';

// The plans a company can be on. Choosing a plan sets its features and limits to the plan's
// template; the platform owner can still adjust either afterwards ("custom" is just that).

const GB = 1024 ** 3;

const PLANS = {
  free: {
    label: 'Free',
    maxEmployees: 5,
    storageLimitBytes: 1 * GB,
    features: { screenCapture: false, audioCapture: false, idleTracking: true, payroll: false, leave: true },
  },
  pro: {
    label: 'Pro',
    maxEmployees: 100,
    storageLimitBytes: 50 * GB,
    features: { screenCapture: true, audioCapture: true, idleTracking: true, payroll: true, leave: true },
  },
  custom: { label: 'Custom' },
};

const PLAN_NAMES = Object.keys(PLANS);

/** Column values that put a company on a plan's template (nothing for "custom"). */
function templateColumns(plan, featureColumn) {
  const p = PLANS[plan];
  if (!p || !p.features) return {};
  const out = { max_employees: p.maxEmployees, storage_limit_bytes: p.storageLimitBytes };
  for (const [name, on] of Object.entries(p.features)) out[featureColumn[name]] = on;
  return out;
}

module.exports = { PLANS, PLAN_NAMES, templateColumns };
