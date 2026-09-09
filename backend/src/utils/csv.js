'use strict';

/**
 * Minimal RFC 4180 CSV writer. A dependency would be overkill for two export endpoints.
 */

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);

  // A leading =, +, - or @ makes Excel treat the cell as a formula. Employee-supplied text
  // (names, window titles) ends up in these exports, so neutralise it on the way out.
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;

  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * @param {Array<{key: string, label: string}>} columns
 * @param {Array<object>} rows
 */
function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

/** Sends a CSV response with a download filename. */
function sendCsv(res, filename, columns, rows) {
  // Strip characters that break Content-Disposition headers: quotes, backslashes,
  // semicolons and newlines. Callers currently pass server-generated names, but
  // sanitizing here means any future caller that passes user-influenced data is safe
  // by default.
  const safeFilename = String(filename).replace(/["\\;\r\n]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  // BOM so Excel opens UTF-8 names correctly.
  res.send('\uFEFF' + toCsv(columns, rows));
}

module.exports = { toCsv, sendCsv, escapeCell };
