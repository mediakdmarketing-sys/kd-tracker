// A small CSV reader for the bulk uploads. Handles quoted cells (with commas, doubled quotes and
// line breaks inside), Windows or Unix line endings, and the byte-order mark Excel adds.

/** @returns {string[][]} rows of cells, blank lines dropped */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Turns CSV text into objects using the wanted columns. A header matches a column by its key or
 * any alias, ignoring case, spaces and underscores ("Daily Rate" = "daily_rate" = "dailyRate").
 *
 * @param {string} text
 * @param {Array<{key: string, aliases?: string[], required?: boolean}>} columns
 * @returns {{ rows: object[], missing: string[] }}  `missing` lists required columns not found
 */
export function readTable(text, columns) {
  const [header = [], ...body] = parseCsv(text);
  const index = {};
  header.forEach((h, i) => {
    const name = normalise(h);
    for (const col of columns) {
      if (index[col.key] === undefined && [col.key, ...(col.aliases || [])].some((a) => normalise(a) === name)) {
        index[col.key] = i;
      }
    }
  });

  const missing = columns.filter((c) => c.required && index[c.key] === undefined).map((c) => c.key);
  const rows = body.map((cells) => {
    const out = {};
    for (const col of columns) {
      const v = index[col.key] === undefined ? undefined : (cells[index[col.key]] ?? '').trim();
      if (v !== undefined && v !== '') out[col.key] = v;
    }
    return out;
  });
  return { rows, missing };
}

/** "$1,250.50" or "1250.5" -> 1250.5. Anything that is not a number stays as typed, so the server rejects it by row. */
export function moneyValue(value) {
  if (value === undefined) return value;
  const n = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : value;
}
