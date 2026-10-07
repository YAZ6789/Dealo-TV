import { describe, expect, it } from 'vitest';
import type { ActivityEvent, LibraryEntry } from '../types';
import { computeStats, netEpisodes, streaks } from './compute';

const ev = (id: string, day: string, s: number, e: number, kind: ActivityEvent['kind'] = 'episode'): ActivityEvent => ({
  kind,
  id,
  at: `${day}T20:00:00`,
  season: s,
  episode: e,
  minutes: 50,
});

describe('netEpisodes', () => {
  it('cancels un-ticked episodes and keeps the latest tick', () => {
    const r = netEpisodes([ev('a', '2026-05-01', 1, 1), ev('a', '2026-05-01', 1, 2), ev('a', '2026-05-02', 1, 2, 'unepisode'), ev('a', '2026-05-03', 1, 1)], () => 40);
    expect(r).toHaveLength(1);
    expect(r[0].day).toBe('2026-05-03');
  });
});

describe('streaks', () => {
  it('computes current and longest runs', () => {
    const days = new Set(['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-07', '2026-05-08']);
    expect(streaks(days, new Date('2026-05-09T10:00:00'))).toEqual({ current: 2, longest: 3 });
    expect(streaks(days, new Date('2026-05-12T10:00:00')).current).toBe(0);
  });
});

describe('computeStats', () => {
  const entry = (id: string, o: Partial<LibraryEntry>): LibraryEntry => ({
    id,
    show: { id, source: 'catalog', title: id, genres: ['drama'], runtime: 50, episodeCount: 20 },
    status: 'completed',
    watched: {},
    addedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...o,
  });

  it('aggregates library, lifetime estimates, ratings and activity', () => {
    const s = computeStats(
      {
        entries: {
          a: entry('a', { rating: 9, seasonSizes: [10, 10] }),
          b: entry('b', { status: 'watching', rating: 6, seasonSizes: [8], watched: { 1: [1, 2, 3] } }),
          c: entry('c', { status: 'plan' }),
        },
        activity: [ev('b', '2026-05-01', 1, 1), ev('b', '2026-05-01', 1, 2), ev('b', '2026-05-01', 1, 3)],
      },
      new Date('2026-05-02T12:00:00'),
    );
    expect(s.total).toBe(3);
    expect(s.byStatus.completed).toBe(1);
    expect(s.trackedEpisodes).toBe(3);
    expect(s.lifetimeEpisodes).toBe(23);
    expect(s.avgRating).toBe(7.5);
    expect(s.ratingHist[8]).toBe(1);
    expect(s.streak.current).toBe(1);
    expect(s.bingeKing?.episodes).toBe(3);
    expect(s.heatmap.at(-1)?.day).toBe('2026-05-02');
    expect(s.heatmap.length).toBeGreaterThanOrEqual(365);
    expect(s.months.at(-1)?.episodes).toBe(3);
  });
});
