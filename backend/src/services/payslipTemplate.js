'use strict';

// The look of a payslip, set by HR in Settings and used by both the payslip page and the email.
//
// Only safe values can get in: colours must be #rrggbb, the font is one of a few fixed families,
// everything else is short text (which is always escaped where it is shown), so a template can
// never inject markup or styles into a page or an email.

const FONTS = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", Courier, monospace',
};

const DEFAULT_TEMPLATE = {
  title: 'Payslip',
  // Empty means the standard explanation of how pay is worked out.
  footerNote: '',
  font: 'sans',
  colors: {
    background: '#ffffff', // the sheet
    headerBackground: '#ffffff', // the band behind the logo and company name
    text: '#1a1b2e',
    accent: '#5b3fd6', // company name, table header line, net pay
  },
  show: {
    logo: true,
    employeeId: true,
    email: true,
    department: true,
    totalHours: true,
    dayBreakdown: true, // the full / half / other hours boxes
    rulesNote: true, // the closing note under the table
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const text = (value, max, fallback) => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);

/**
 * Turns whatever is stored (or sent) into a complete, valid template: anything missing or invalid
 * falls back to the default for that field alone.
 */
function normalise(input) {
  const src = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_TEMPLATE;

  const colors = {};
  for (const key of Object.keys(d.colors)) {
    const v = src.colors?.[key];
    colors[key] = typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d.colors[key];
  }
  const show = {};
  for (const key of Object.keys(d.show)) {
    show[key] = typeof src.show?.[key] === 'boolean' ? src.show[key] : d.show[key];
  }

  return {
    title: text(src.title, 40, d.title) || d.title,
    footerNote: text(src.footerNote, 600, d.footerNote),
    font: Object.prototype.hasOwnProperty.call(FONTS, src.font) ? src.font : d.font,
    colors,
    show,
  };
}

/** Applies a partial change on top of the current template. */
function merge(current, patch) {
  if (!patch) return current;
  return normalise({
    ...current,
    ...patch,
    colors: { ...current.colors, ...patch.colors },
    show: { ...current.show, ...patch.show },
  });
}

function parse(json) {
  if (!json) return normalise(null);
  try {
    return normalise(JSON.parse(json));
  } catch {
    return normalise(null);
  }
}

module.exports = { DEFAULT_TEMPLATE, FONTS, normalise, merge, parse };
