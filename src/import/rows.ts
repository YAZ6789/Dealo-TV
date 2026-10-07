/**
 * Turn a mapped {@link Table} into clean, de-duplicated import rows.
 */
import type { GenreKey, Position, WatchStatus } from '../types';
import { parseGenreText } from '../lib/genres';
import { normalizeTitle } from '../lib/text';
import {
  detectRatingScale,
  normalizeStatus,
  parseBool,
  parseCount,
  parseDate,
  parseProgress,
  parseRating,
  parseYear,
  type ColumnMapping,
} from './mapping';
import type { Table } from './table';

export interface ImportRow {
  /** 0-based within table.rows (the first row when rows were merged). */
  rowIndex: number;
  /** Cleaned title (year / season markers / trailing emoji stripped). */
  title: string;
  year?: number;
  status?: WatchStatus;
  /** True when `status` was inferred rather than read from the sheet. */
  statusInferred?: boolean;
  /** The sheet says "not interested" / "never" / ❌ … */
  blocked?: boolean;
  position?: Position;
  /** 1–10, half steps. */
  rating?: number;
  notes?: string;
  genres?: GenreKey[];
  platform?: string;
  favorite?: boolean;
  /** ISO yyyy-mm-dd */
  startedAt?: string;
  /** ISO yyyy-mm-dd */
  finishedAt?: string;
  tmdbId?: number;
  imdbId?: string;
  /** All row indexes merged into this row (only set when > 1). */
  mergedRowIndexes?: number[];
  /** header → cell, for the review UI. */
  raw: Record<string, string>;
}

export interface TableToRowsOptions {
  /** Status for rows with no status information (e.g. the tab is called "Watched"). */
  defaultStatus?: WatchStatus;
  /** Scale of plain-number ratings; inferred from the header/values when omitted. */
  ratingScale?: 5 | 10 | 100;
  /** Merge rows with the same normalized title (default true). */
  dedupe?: boolean;
}

const DECOR_TRAIL = /[\s✓✔✅☑★☆⭐*!❤♥•·\-–—|:,;~_+\p{Extended_Pictographic}️‍]+$/u;
const DECOR_LEAD = /^[\s✓✔✅☑★☆⭐*•·\-–—|~_+>\p{Extended_Pictographic}️‍]+/u;

/**
 * Clean a title cell. Returns the title plus anything encoded in it:
 *  "Dark (2017)" → year 2017; "Stranger Things S3", "Stranger Things - Season 3",
 *  "Stranger Things (Season 3)" → season 3; "Lost S2E5" → position;
 *  trailing ✓ / emoji / asterisks and list numbering ("1. ") are removed.
 */
export function cleanTitle(cell: string): { title: string; year?: number; position?: Position } {
  const original = String(cell ?? '').trim();
  let t = original;
  let year: number | undefined;
  let position: Position | undefined;

  const strip = () => {
    t = t.replace(DECOR_TRAIL, '').replace(DECOR_LEAD, '').trim();
  };
  strip();
  t = t.replace(/^\d{1,3}[.)]\s+(?=\S)/, '');

  for (let pass = 0; pass < 2; pass++) {
    const y = t.match(/\s*[([]\s*((?:19|20)\d{2})\s*(?:[-–]\s*(?:(?:19|20)\d{2})?\s*)?[)\]]\s*$/);
    if (y) {
      year ??= +y[1];
      t = t.slice(0, y.index).trim();
      strip();
    }
    const sxe = t.match(/\s*[-–—:,(]?\s*\b(s\d{1,2}\s*e\d{1,3})\s*\)?\s*$/i);
    if (sxe) {
      position ??= parseProgress(sxe[1]);
      t = t.slice(0, sxe.index).trim();
      strip();
    }
    const season =
      t.match(/\s*[([]\s*(?:season|s)\s*\.?\s*(\d{1,2})\s*[)\]]\s*$/i) ??
      t.match(/\s*[-–—:,]\s*(?:season|s)\s*\.?\s*(\d{1,2})\s*$/i) ??
      t.match(/\s+(?:season|s)\s*\.?\s*(\d{1,2})\s*$/i);
    if (season && season.index! > 0) {
      position ??= { season: +season[1], episode: 0 };
      t = t.slice(0, season.index).trim();
      strip();
    }
  }
  if (!t) t = original;
  return { title: t, year, position };
}

const STATUS_RANK: Record<WatchStatus, number> = { plan: 1, dropped: 2, on_hold: 3, watching: 4, completed: 5 };

/** Compare positions: negative when a < b. */
export function comparePosition(a: Position, b: Position): number {
  return a.season - b.season || a.episode - b.episode;
}

/**
 * Convert table rows into {@link ImportRow}s.
 *
 * Status inference, for rows with no usable status cell (and not blocked):
 *  1. watched-flag TRUE            → completed
 *  2. a finished date              → completed
 *  3. a position (progress/season) → watching
 *  4. watched-flag FALSE           → plan
 *  5. `opts.defaultStatus`, if given
 *  6. a rating                     → completed (you rated it, so you saw it)
 *  7. a started date               → watching
 *  8. otherwise                    → plan
 * Inferred statuses are flagged with `statusInferred: true`.
 */
export function tableToRows(
  table: Table,
  mapping: ColumnMapping,
  opts: TableToRowsOptions = {},
): { rows: ImportRow[]; skipped: { rowIndex: number; reason: string }[] } {
  const skipped: { rowIndex: number; reason: string }[] = [];
  const out: ImportRow[] = [];
  const ti = mapping.title;
  if (ti === undefined) {
    return { rows: [], skipped: table.rows.map((_, rowIndex) => ({ rowIndex, reason: 'no title column' })) };
  }

  const ratingScale =
    opts.ratingScale ??
    (mapping.rating !== undefined
      ? detectRatingScale(table.headers[mapping.rating] ?? '', table.rows.map((r) => r[mapping.rating!] ?? ''))
      : 10);
  const headerLower = table.headers.map((h) => h.trim().toLowerCase());

  table.rows.forEach((row, rowIndex) => {
    const cell = (j: number | undefined) => (j === undefined ? '' : (row[j] ?? '').trim());
    const titleCell = cell(ti);
    if (!titleCell || !/[\p{L}\p{N}]/u.test(titleCell)) {
      skipped.push({ rowIndex, reason: 'missing title' });
      return;
    }
    // A repeated header row (common when several lists are pasted together).
    const filled = row.map((c, j) => [c.trim().toLowerCase(), headerLower[j]] as const).filter(([c]) => c);
    if (titleCell.toLowerCase() === headerLower[ti] && filled.filter(([c, h]) => c === h).length >= Math.ceil(filled.length / 2)) {
      skipped.push({ rowIndex, reason: 'repeated header' });
      return;
    }

    const cleaned = cleanTitle(titleCell);
    const r: ImportRow = { rowIndex, title: cleaned.title, raw: {} };
    table.headers.forEach((h, j) => (r.raw[h] = row[j] ?? ''));

    const year = parseYear(cell(mapping.year)) ?? cleaned.year;
    if (year) r.year = year;

    const st = normalizeStatus(cell(mapping.status));
    if (st === 'blocked') r.blocked = true;
    else if (st) r.status = st;

    // Position: progress column wins, then season/episode columns, then the title.
    let position = parseProgress(cell(mapping.progress));
    if (!position && (mapping.season !== undefined || mapping.episode !== undefined)) {
      const sCell = cell(mapping.season);
      const eCell = cell(mapping.episode);
      const sp = parseProgress(sCell);
      if (sp && sp.episode > 0) position = sp;
      else {
        const season = parseCount(sCell);
        const episode = parseCount(eCell) ?? parseProgress(eCell)?.episode;
        if (season !== undefined && season > 0) position = { season, episode: episode ?? 0 };
        else if (episode !== undefined && episode > 0) position = { season: 1, episode };
      }
    }
    position ??= cleaned.position;
    if (position) r.position = position;

    const rating = parseRating(cell(mapping.rating), ratingScale);
    if (rating !== undefined) r.rating = rating;

    const notes = cell(mapping.notes);
    if (notes) r.notes = notes;

    if (mapping.genre !== undefined) {
      const g = parseGenreText(cell(mapping.genre));
      if (g.length) r.genres = g;
    }
    const platform = cell(mapping.platform);
    if (platform) r.platform = platform;

    const fav = cell(mapping.favorite);
    if (fav && (parseBool(fav) === true || /[❤♥💖💕⭐★]/u.test(fav))) r.favorite = true;

    const startedAt = parseDate(cell(mapping.startedAt));
    if (startedAt) r.startedAt = startedAt;
    const finishedAt = parseDate(cell(mapping.finishedAt));
    if (finishedAt) r.finishedAt = finishedAt;

    const tm = cell(mapping.tmdbId).match(/(?:^|tv\/|tmdb:)(\d+)/);
    if (tm) r.tmdbId = +tm[1];
    const im = cell(mapping.imdbId).match(/tt\d{5,10}/i);
    if (im) r.imdbId = im[0].toLowerCase();

    const flag = parseBool(cell(mapping.watchedFlag));
    if (!r.status && !r.blocked) {
      let inferred: WatchStatus;
      if (flag === true) inferred = 'completed';
      else if (r.finishedAt) inferred = 'completed';
      else if (r.position) inferred = 'watching';
      else if (flag === false) inferred = 'plan';
      else if (opts.defaultStatus) inferred = opts.defaultStatus;
      else if (r.rating !== undefined) inferred = 'completed';
      else if (r.startedAt) inferred = 'watching';
      else inferred = 'plan';
      r.status = inferred;
      // A ticked "watched?" box is as good as an explicit status.
      if (flag !== true) r.statusInferred = true;
    }
    out.push(r);
  });

  return { rows: opts.dedupe === false ? out : dedupeRows(out), skipped };
}

/**
 * Merge rows that share a normalized title (and the same or a missing year).
 * Keeps the most advanced status (completed > watching > on_hold > dropped > plan;
 * explicit statuses beat inferred ones), the furthest position, the latest
 * rating, and concatenates distinct notes.
 */
export function dedupeRows(rows: ImportRow[]): ImportRow[] {
  const groups = new Map<string, ImportRow[]>();
  const out: ImportRow[] = [];
  for (const row of rows) {
    const key = normalizeTitle(row.title) || row.title.toLowerCase();
    const bucket = groups.get(key) ?? [];
    const target = bucket.find((b) => b.year === undefined || row.year === undefined || b.year === row.year);
    if (target) {
      mergeInto(target, row);
    } else {
      const copy: ImportRow = { ...row, raw: { ...row.raw } };
      bucket.push(copy);
      groups.set(key, bucket);
      out.push(copy);
    }
  }
  return out;
}

function mergeInto(a: ImportRow, b: ImportRow): void {
  a.mergedRowIndexes = [...(a.mergedRowIndexes ?? [a.rowIndex]), b.rowIndex];
  a.year ??= b.year;

  // Status: explicit beats inferred, then the most advanced.
  const aExplicit = a.status && !a.statusInferred;
  const bExplicit = b.status && !b.statusInferred;
  if (b.status) {
    if (!a.status || (bExplicit && !aExplicit) || (!!bExplicit === !!aExplicit && STATUS_RANK[b.status] > STATUS_RANK[a.status])) {
      a.status = b.status;
      a.statusInferred = b.statusInferred;
      if (!a.statusInferred) delete a.statusInferred;
    }
  }
  // "Not interested" survives only when no row has an explicit status.
  if (aExplicit || bExplicit) delete a.blocked;
  else if (a.blocked || b.blocked) {
    a.blocked = true;
    delete a.status;
    delete a.statusInferred;
  }

  if (b.position && (!a.position || comparePosition(b.position, a.position) > 0)) a.position = b.position;
  if (b.rating !== undefined) a.rating = b.rating;
  if (b.notes) {
    if (!a.notes) a.notes = b.notes;
    else if (!a.notes.includes(b.notes)) a.notes = `${a.notes}\n${b.notes}`;
  }
  if (b.genres?.length) a.genres = [...new Set([...(a.genres ?? []), ...b.genres])];
  a.platform ??= b.platform;
  if (b.favorite) a.favorite = true;
  if (b.startedAt && (!a.startedAt || b.startedAt < a.startedAt)) a.startedAt = b.startedAt;
  if (b.finishedAt && (!a.finishedAt || b.finishedAt > a.finishedAt)) a.finishedAt = b.finishedAt;
  a.tmdbId ??= b.tmdbId;
  a.imdbId ??= b.imdbId;
}
