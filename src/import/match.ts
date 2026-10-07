/**
 * Match import rows against a metadata provider's search.
 */
import type { ShowSummary } from '../types';
import { stripTitleQualifier, titleQualifier, titleSimilarity } from '../lib/text';
import type { ImportRow } from './rows';

export type SearchFn = (query: string, year?: number) => Promise<ShowSummary[]>;

export interface MatchResult {
  row: ImportRow;
  /** Candidates sorted best-first (deduplicated by id). */
  candidates: ShowSummary[];
  /** Best candidate; undefined when state is 'none'. */
  best?: ShowSummary;
  /** 0–1 score of the best candidate (1 for an exact external-id match). */
  confidence: number;
  state: 'auto' | 'review' | 'none';
  /** Set when the search failed twice for this row. */
  error?: string;
}

export interface MatchOptions {
  /** Parallel searches (default 4). */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Minimum confidence for an automatic match (default 0.82). */
  autoThreshold?: number;
  /** Minimum lead over the runner-up for an automatic match (default 0.08). */
  autoMargin?: number;
  /** Below this the best candidate is not offered (default 0.45). */
  minScore?: number;
}

const COUNTRY_ALIASES: Record<string, string> = { UK: 'GB', USA: 'US', ENG: 'GB' };

function exactIdMatch(row: ImportRow, show: ShowSummary): boolean {
  if (row.tmdbId !== undefined && (show.externalIds?.tmdb === row.tmdbId || show.id === `tmdb:${row.tmdbId}`)) return true;
  if (row.imdbId && show.externalIds?.imdb && show.externalIds.imdb.toLowerCase() === row.imdbId.toLowerCase()) return true;
  return false;
}

function rawScore(row: ImportRow, show: ShowSummary, rank: number): number {
  if (exactIdMatch(row, show)) return 2;
  let score = Math.max(
    titleSimilarity(row.title, show.title),
    show.originalTitle ? titleSimilarity(row.title, show.originalTitle) : 0,
  );
  if (row.year && show.year) {
    const d = Math.abs(row.year - show.year);
    if (d === 0) score += 0.15;
    else if (d === 1) score += 0.08;
    else if (d > 2) score -= 0.2;
  }
  // "The Office (US)" → prefer the US show.
  const q = titleQualifier(row.title);
  if (q && /^[A-Z]{2,3}$/.test(q) && show.country) {
    score += (COUNTRY_ALIASES[q] ?? q) === show.country.toUpperCase() ? 0.1 : -0.1;
  }
  // Small tie-breakers: provider rank and popularity.
  score += Math.max(0, 0.03 - rank * 0.01);
  score += Math.min(100, Math.max(0, show.popularity ?? 0)) * 0.0002;
  return score;
}

/**
 * Confidence (0–1) that `show` is the show described by `row`.
 * Title similarity (also against `originalTitle`) dominates; ±year bonus/penalty;
 * tiny provider-rank/popularity tie-break; exact TMDB/IMDb id → 1.
 */
export function scoreCandidate(row: ImportRow, show: ShowSummary, rank: number): number {
  return Math.max(0, Math.min(1, rawScore(row, show, rank)));
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Match one row: search (retry once on failure; retry without year on no results), score, classify. */
export async function matchRow(row: ImportRow, search: SearchFn, opts: MatchOptions = {}): Promise<MatchResult> {
  const { signal } = opts;
  const autoThreshold = opts.autoThreshold ?? 0.82;
  const autoMargin = opts.autoMargin ?? 0.08;
  const minScore = opts.minScore ?? 0.45;
  const query = stripTitleQualifier(row.title).trim() || row.title;

  const run = async (year?: number): Promise<ShowSummary[]> => {
    try {
      return (await raceAbort(Promise.resolve().then(() => search(query, year)), signal)) ?? [];
    } catch {
      if (signal?.aborted) throw abortError(signal);
      return (await raceAbort(Promise.resolve().then(() => search(query, year)), signal)) ?? [];
    }
  };

  let found: ShowSummary[];
  try {
    found = await run(row.year);
    if (!found.length && row.year) found = await run(undefined);
  } catch (e) {
    if (signal?.aborted) throw abortError(signal);
    return { row, candidates: [], confidence: 0, state: 'none', error: e instanceof Error ? e.message : String(e) };
  }

  const seen = new Set<string>();
  const scored = found
    .filter((s) => s && !seen.has(s.id) && (seen.add(s.id), true))
    .map((show, rank) => ({ show, raw: rawScore(row, show, rank) }))
    .sort((a, b) => b.raw - a.raw);

  if (!scored.length) return { row, candidates: [], confidence: 0, state: 'none' };
  const top = scored[0];
  const confidence = Math.round(Math.max(0, Math.min(1, top.raw)) * 1000) / 1000;
  const candidates = scored.map((s) => s.show);
  if (top.raw >= 2) return { row, candidates, best: top.show, confidence: 1, state: 'auto' };
  if (confidence < minScore) return { row, candidates, confidence, state: 'none' };
  const margin = scored.length > 1 ? top.raw - scored[1].raw : Infinity;
  const state = confidence >= autoThreshold && margin >= autoMargin ? 'auto' : 'review';
  return { row, candidates, best: top.show, confidence, state };
}

/**
 * Match every row with a concurrency-limited queue. Results keep row order.
 * Rejects with an AbortError when `signal` aborts.
 */
export async function matchRows(rows: ImportRow[], search: SearchFn, opts: MatchOptions = {}): Promise<MatchResult[]> {
  const { signal, onProgress } = opts;
  const total = rows.length;
  const results: MatchResult[] = new Array(total);
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));
  let next = 0;
  let done = 0;
  if (signal?.aborted) throw abortError(signal);
  onProgress?.(0, total);

  const worker = async () => {
    while (next < total) {
      if (signal?.aborted) throw abortError(signal);
      const i = next++;
      results[i] = await matchRow(rows[i], search, opts);
      done++;
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  if (signal?.aborted) throw abortError(signal);
  return results;
}
