/**
 * The common tabular shape every importer (Google Sheets, CSV, Excel)
 * produces, plus header-row detection for messy, hand-made sheets.
 */
import Papa from 'papaparse';
import { headerRoleScores, normalizeStatus, parseBool, parseDate, parseProgress } from './mapping';

/** A rectangular table. Every cell is a trimmed string ('' for empty). */
export interface Table {
  headers: string[];
  rows: string[][];
}

/** 0 → "A", 25 → "Z", 26 → "AA" (spreadsheet column letters). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Coerce any spreadsheet cell value to a trimmed string. */
export function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Parse CSV/TSV text (delimiter auto-detected) and detect the header row. */
export function parseCsv(text: string): Table {
  const res = Papa.parse<string[]>(String(text ?? '').replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
  });
  return detectHeaderRow(res.data);
}

const nonEmpty = (row: string[]) => row.reduce((n, c) => n + (c !== '' ? 1 : 0), 0);

/** A cell that is clearly a data value, never a column header. */
function isDataValue(cell: string): boolean {
  if (!cell) return false;
  if (!/\p{L}/u.test(cell)) return true; // numbers, dates, emoji, symbols
  if (parseDate(cell)) return true;
  if (parseProgress(cell)) return true;
  if (/^(?:true|false)$/i.test(cell)) return true;
  if (/^tt\d{5,}$/i.test(cell) || /^https?:\/\//i.test(cell)) return true;
  return false;
}

function isHeaderLike(row: string[]): boolean {
  const cells = row.filter(Boolean);
  if (!cells.length) return false;
  return cells.every((c) => c.length <= 60 && !isDataValue(c));
}

/** Number of cells that read as a known column name ("Title", "Status", "My rating"…). */
function knownHeaderHits(row: string[]): number {
  let hits = 0;
  for (const cell of row) {
    if (!cell) continue;
    const scores = headerRoleScores(cell);
    const best = Math.max(0, ...Object.values(scores));
    if (best < 0.6) continue;
    // A bare status value ("Watched", "Done") in a data row is not a header —
    // unless it's a header-only word like "Status" itself.
    if (normalizeStatus(cell) && !((scores.status ?? 0) >= 1)) continue;
    hits++;
  }
  return hits;
}

/** Is cell `v` of a clearly different "kind" (number/date/bool/progress) than a text header? */
function isTypedValue(v: string): boolean {
  if (!v) return false;
  if (/^-?\d+(?:[.,]\d+)?%?$/.test(v)) return true;
  if (parseDate(v) || parseProgress(v)) return true;
  if (parseBool(v) !== undefined && !/\p{L}{3,}/u.test(v)) return true;
  if (/^(?:true|false)$/i.test(v)) return true;
  return !/\p{L}/u.test(v);
}

function hasTypeContrast(header: string[], data: string[][]): boolean {
  const sample = data.slice(0, 25);
  for (let j = 0; j < header.length; j++) {
    if (!header[j] || isTypedValue(header[j])) continue;
    const vals = sample.map((r) => r[j]).filter(Boolean);
    if (vals.length < 2) continue;
    const typed = vals.filter(isTypedValue).length;
    if (typed / vals.length >= 0.6) return true;
  }
  return false;
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, j) => {
    let name = h || `Column ${columnLetter(j)}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

/**
 * Turn a raw cell matrix into a {@link Table}.
 *  - trims cells, drops fully-empty rows and trailing fully-empty columns;
 *  - finds the header row: the first of the top rows that reads as known
 *    column names (skipping title-banner rows above it), otherwise row 0 if
 *    it looks like a header (text over a column of numbers/dates/flags);
 *  - when no header row is found, every row is data and headers are
 *    synthesized as "Column A", "Column B", …
 * Headers are always non-empty and unique.
 */
export function detectHeaderRow(matrix: unknown[][]): Table {
  let m = (matrix ?? []).map((r) => (Array.isArray(r) ? r : []).map(cellToString));
  m = m.filter((r) => nonEmpty(r) > 0);
  if (!m.length) return { headers: [], rows: [] };

  let width = 0;
  for (const r of m) {
    for (let j = r.length - 1; j >= 0; j--) {
      if (r[j] !== '') {
        width = Math.max(width, j + 1);
        break;
      }
    }
  }
  m = m.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? ''));

  const build = (headerIdx: number | null): Table => {
    if (headerIdx === null) {
      return { headers: uniqueHeaders(Array.from({ length: width }, () => '')), rows: m };
    }
    return { headers: uniqueHeaders(m[headerIdx]), rows: m.slice(headerIdx + 1) };
  };

  // 1) A row of recognisable column names within the first few rows.
  const limit = Math.min(m.length, 6);
  for (let i = 0; i < limit; i++) {
    const row = m[i];
    if (!isHeaderLike(row)) continue;
    const hits = knownHeaderHits(row);
    const filled = nonEmpty(row);
    if (hits === 0) continue;
    // A lone cell in a multi-column sheet is a title banner, not a header.
    if (width > 1 && filled < 2) continue;
    if (!(hits >= 2 || hits / filled >= 0.34 || width === 1)) continue;
    // Rows above must be banners (fewer filled cells than the header).
    if (m.slice(0, i).every((r) => nonEmpty(r) < Math.max(2, filled))) return build(i);
  }

  // 2) Skip banner rows, then accept a text row sitting on top of typed data.
  let start = 0;
  while (start < m.length - 1 && nonEmpty(m[start]) <= 1 && nonEmpty(m[start + 1]) >= 2) start++;
  const candidate = m[start];
  if (width >= 2 && isHeaderLike(candidate) && nonEmpty(candidate) >= 2 && hasTypeContrast(candidate, m.slice(start + 1))) {
    return build(start);
  }

  // 3) Headerless data.
  return build(null);
}
