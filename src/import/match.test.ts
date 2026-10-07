import { describe, expect, it, vi } from 'vitest';
import type { ShowSummary } from '../types';
import { matchRow, matchRows, scoreCandidate, type SearchFn } from './match';
import type { ImportRow } from './rows';

const show = (id: string, title: string, extra: Partial<ShowSummary> = {}): ShowSummary => ({
  id,
  source: 'tmdb',
  title,
  genres: [],
  ...extra,
});
const row = (title: string, extra: Partial<ImportRow> = {}): ImportRow => ({ rowIndex: 0, title, raw: {}, ...extra });

const BB = show('tmdb:1396', 'Breaking Bad', { year: 2008, popularity: 90, externalIds: { tmdb: 1396, imdb: 'tt0903747' } });
const BB_MINI = show('tmdb:9999', 'Breaking Bad: Original Minisodes', { year: 2009 });
const OFFICE_US = show('tmdb:2316', 'The Office', { year: 2005, country: 'US', popularity: 95 });
const OFFICE_UK = show('tmdb:2996', 'The Office', { year: 2001, country: 'GB', popularity: 60 });
const DARK = show('tmdb:70523', 'Dark', { year: 2017, originalTitle: 'Dark' });
const MONEY_HEIST = show('tmdb:71446', 'Money Heist', { year: 2017, originalTitle: 'La casa de papel' });

describe('scoreCandidate', () => {
  it('rewards exact titles and matching years', () => {
    expect(scoreCandidate(row('Breaking Bad'), BB, 0)).toBe(1);
    expect(scoreCandidate(row('Breaking Bad', { year: 2008 }), BB, 0)).toBe(1);
    expect(scoreCandidate(row('Breaking Bad'), BB_MINI, 1)).toBeLessThan(0.8);
  });
  it('applies year bonuses/penalties', () => {
    const base = scoreCandidate(row('Breaking Bd'), BB, 3);
    expect(scoreCandidate(row('Breaking Bd', { year: 2008 }), BB, 3)).toBeCloseTo(Math.min(1, base + 0.15), 5);
    expect(scoreCandidate(row('Breaking Bd', { year: 2009 }), BB, 3)).toBeCloseTo(Math.min(1, base + 0.08), 5);
    expect(scoreCandidate(row('Breaking Bd', { year: 2010 }), BB, 3)).toBeCloseTo(base, 5);
    expect(scoreCandidate(row('Breaking Bd', { year: 2015 }), BB, 3)).toBeCloseTo(base - 0.2, 5);
  });
  it('matches the original title', () => {
    expect(scoreCandidate(row('La Casa de Papel'), MONEY_HEIST, 0)).toBe(1);
  });
  it('exact external ids win', () => {
    expect(scoreCandidate(row('Totally different', { tmdbId: 1396 }), BB, 5)).toBe(1);
    expect(scoreCandidate(row('Totally different', { imdbId: 'TT0903747' }), BB, 5)).toBe(1);
    expect(scoreCandidate(row('x', { tmdbId: 70523 }), DARK, 5)).toBe(1); // via id 'tmdb:<n>'
  });
  it('stays within [0, 1]', () => {
    expect(scoreCandidate(row('zzz', { year: 1950 }), BB, 9)).toBeGreaterThanOrEqual(0);
  });
});

describe('matchRow', () => {
  it('auto-matches a clear winner', async () => {
    const search: SearchFn = async () => [BB, BB_MINI];
    const r = await matchRow(row('Breaking Bad'), search);
    expect(r.state).toBe('auto');
    expect(r.best).toBe(BB);
    expect(r.confidence).toBe(1);
    expect(r.candidates).toEqual([BB, BB_MINI]);
  });

  it('flags ambiguity for review', async () => {
    const search: SearchFn = async () => [OFFICE_US, OFFICE_UK];
    const r = await matchRow(row('The Office'), search);
    expect(r.state).toBe('review');
    expect(r.best).toBe(OFFICE_US);
    expect(r.candidates).toHaveLength(2);
  });

  it('uses the year to disambiguate', async () => {
    const search: SearchFn = async () => [OFFICE_US, OFFICE_UK];
    const r = await matchRow(row('The Office', { year: 2001 }), search);
    expect(r.state).toBe('auto');
    expect(r.best).toBe(OFFICE_UK);
  });

  it('uses a country qualifier to disambiguate and searches without it', async () => {
    const search = vi.fn<SearchFn>(async () => [OFFICE_US, OFFICE_UK]);
    const r = await matchRow(row('The Office (UK)'), search);
    expect(search).toHaveBeenCalledWith('The Office', undefined);
    expect(r.best).toBe(OFFICE_UK);
    expect(r.state).toBe('auto');
  });

  it("returns 'none' when there are no results", async () => {
    const r = await matchRow(row('Nonexistent Show'), async () => []);
    expect(r).toMatchObject({ state: 'none', candidates: [], confidence: 0 });
    expect(r.best).toBeUndefined();
  });

  it("returns 'none' (but keeps candidates) when nothing is close", async () => {
    const r = await matchRow(row('Gilmore Girls'), async () => [DARK]);
    expect(r.state).toBe('none');
    expect(r.best).toBeUndefined();
    expect(r.candidates).toEqual([DARK]);
  });

  it('retries without the year when the year-filtered search is empty', async () => {
    const search = vi.fn<SearchFn>(async (_q, year) => (year ? [] : [DARK]));
    const r = await matchRow(row('Dark', { year: 2018 }), search);
    expect(search.mock.calls).toEqual([
      ['Dark', 2018],
      ['Dark', undefined],
    ]);
    expect(r.best).toBe(DARK);
    expect(r.state).toBe('auto');
  });

  it('retries once on rejection', async () => {
    let calls = 0;
    const search: SearchFn = async () => {
      calls++;
      if (calls === 1) throw new Error('rate limited');
      return [DARK];
    };
    const r = await matchRow(row('Dark'), search);
    expect(calls).toBe(2);
    expect(r.state).toBe('auto');
  });

  it('gives up after the retry and reports the error', async () => {
    const search = vi.fn<SearchFn>(async () => {
      throw new Error('offline');
    });
    const r = await matchRow(row('Dark'), search);
    expect(search).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ state: 'none', error: 'offline' });
  });

  it('auto-matches an exact id even when the title is ambiguous', async () => {
    const r = await matchRow(row('The Office', { tmdbId: 2996 }), async () => [OFFICE_US, OFFICE_UK]);
    expect(r.state).toBe('auto');
    expect(r.best).toBe(OFFICE_UK);
    expect(r.confidence).toBe(1);
  });

  it('dedupes candidates by id and honours a custom threshold', async () => {
    const r = await matchRow(row('Dark'), async () => [DARK, DARK], { autoThreshold: 1.01 });
    expect(r.candidates).toEqual([DARK]);
    expect(r.state).toBe('review');
  });
});

describe('matchRows', () => {
  it('keeps order, limits concurrency and reports progress', async () => {
    let active = 0;
    let maxActive = 0;
    const search: SearchFn = async (q) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return [show(`tmdb:${q}`, q)];
    };
    const rows = ['A show', 'B show', 'C show', 'D show', 'E show', 'F show'].map((t, i) => row(t, { rowIndex: i }));
    const progress: [number, number][] = [];
    const res = await matchRows(rows, search, { concurrency: 2, onProgress: (d, t) => progress.push([d, t]) });
    expect(res.map((r) => r.best?.title)).toEqual(['A show', 'B show', 'C show', 'D show', 'E show', 'F show']);
    expect(maxActive).toBe(2);
    expect(progress[0]).toEqual([0, 6]);
    expect(progress[progress.length - 1]).toEqual([6, 6]);
  });

  it('handles an empty list', async () => {
    expect(await matchRows([], async () => [])).toEqual([]);
  });

  it('aborts promptly', async () => {
    const ctrl = new AbortController();
    const search = vi.fn<SearchFn>(() => new Promise(() => {})); // never resolves
    const rows = [row('Dark'), row('Lost'), row('Fargo')];
    const p = matchRows(rows, search, { concurrency: 1, signal: ctrl.signal });
    await Promise.resolve();
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately with an already-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const search = vi.fn<SearchFn>(async () => []);
    await expect(matchRows([row('Dark')], search, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(search).not.toHaveBeenCalled();
  });
});
