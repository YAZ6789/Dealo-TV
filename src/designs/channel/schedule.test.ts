import { describe, expect, it } from 'vitest';
import { epAfter, schedule, slotMinutes } from './schedule';
import type { LibraryEntry, ShowSummary } from '../../types';

const show = { id: 'x', title: 'X', genres: [], source: 'catalog' } as unknown as ShowSummary;
const entry = (over: Partial<LibraryEntry>): LibraryEntry =>
  ({ id: 'x', show, status: 'watching', watched: {}, addedAt: '2024-01-01', updatedAt: '2024-01-01', ...over }) as LibraryEntry;

describe('epAfter', () => {
  it('steps within a season and across seasons', () => {
    expect(epAfter({ season: 1, episode: 2 }, [3, 4])).toEqual({ season: 1, episode: 3 });
    expect(epAfter({ season: 1, episode: 3 }, [3, 4])).toEqual({ season: 2, episode: 1 });
    expect(epAfter({ season: 2, episode: 4 }, [3, 4])).toBeUndefined();
  });
  it('keeps counting when season sizes are unknown', () => {
    expect(epAfter({ season: 2, episode: 9 })).toEqual({ season: 2, episode: 10 });
  });
});

describe('schedule', () => {
  it('watching: now = next unwatched, then next', () => {
    const s = schedule({ show, entry: entry({ watched: { 1: [1, 2, 3] }, seasonSizes: [3, 2] }) });
    expect(s[0]).toMatchObject({ kind: 'now', label: 'S2·E01' });
    expect(s[1]).toMatchObject({ kind: 'next', label: 'S2·E02' });
    expect(s[2]).toMatchObject({ kind: 'offair' });
  });
  it('caught up shows say so', () => {
    const s = schedule({ show, entry: entry({ watched: { 1: [1, 2] }, seasonSizes: [2] }) });
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('offair');
  });
  it('watchlist, watched and recommendations start at the pilot', () => {
    expect(schedule({ show, entry: entry({ status: 'plan' }) })[0]).toMatchObject({ kind: 'premiere', label: 'S1·E01' });
    expect(schedule({ show, entry: entry({ status: 'completed', seasonSizes: [1] }) })).toEqual([
      expect.objectContaining({ kind: 'rerun', label: 'S1·E01' }),
      expect.objectContaining({ kind: 'offair' }),
    ]);
    expect(schedule({ show })[0]).toMatchObject({ kind: 'pilot' });
  });
  it('clamps runtimes for the timeline', () => {
    expect(slotMinutes()).toBe(45);
    expect(slotMinutes(5)).toBe(20);
    expect(slotMinutes(200)).toBe(70);
  });
});
