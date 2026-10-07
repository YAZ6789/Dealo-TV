import { describe, expect, it } from 'vitest';
import type { ActivityEvent, LibraryEntry } from '../types';
import { computeWrapped, defaultWrappedYear, pickPersona, wrappedText, wrappedYears } from './wrapped';
import { buildDemoDoc } from '../lib/demo';

const ev = (id: string, at: string, s: number, e: number, kind: ActivityEvent['kind'] = 'episode'): ActivityEvent => ({ kind, id, at, season: s, episode: e, minutes: 50 });

const entry = (id: string, o: Partial<LibraryEntry> = {}, show: Partial<LibraryEntry['show']> = {}): LibraryEntry => ({
  id,
  show: { id, source: 'catalog', title: id.toUpperCase(), genres: ['drama'], runtime: 50, episodeCount: 10, language: 'en', ...show },
  status: 'watching',
  watched: {},
  addedAt: '2025-01-01T00:00:00',
  updatedAt: '2025-01-01T00:00:00',
  ...o,
});

/** n episodes of show `id` on local day `day` starting at `hour`. */
const day = (id: string, d: string, n: number, hour = 20, from = 1): ActivityEvent[] =>
  Array.from({ length: n }, (_, i) => ev(id, `${d}T${String((hour + Math.floor(i / 2)) % 24).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`, 1, from + i));

describe('computeWrapped (activity year)', () => {
  const entries = {
    a: entry('a', { status: 'completed', startedAt: '2025-01-03T20:00:00', completedAt: '2025-01-05T22:00:00', rating: 9 }, { genres: ['drama', 'crime'] }),
    b: entry('b', { status: 'completed', startedAt: '2025-03-01T20:00:00', completedAt: '2025-03-20T22:00:00', rating: 7 }, { genres: ['comedy'], language: 'ko' }),
    c: entry('c', { status: 'watching' }, { genres: ['scifi', 'drama'], language: 'de' }),
    old: entry('old', { status: 'completed', startedAt: '2024-05-01T20:00:00', completedAt: '2024-06-01T20:00:00' }),
  };
  const activity = [
    ...day('old', '2024-12-31', 2),
    ...day('a', '2025-01-03', 3), // Fri
    ...day('a', '2025-01-04', 6, 20, 4), // Sat — binge
    ...day('a', '2025-01-05', 1, 21, 10),
    ...day('b', '2025-03-01', 2),
    ...day('b', '2025-03-02', 2, 20, 3),
    ...day('c', '2025-12-30', 1, 23),
    ev('c', '2025-12-31T23:30:00', 1, 2),
    ev('c', '2025-12-31T23:40:00', 1, 3),
    ev('c', '2026-01-01T23:40:00', 1, 3, 'unepisode'),
  ];
  const w = computeWrapped({ entries, activity }, 2025);

  it('counts net episodes and hours inside the year only', () => {
    // a: 3+6+1 = 10, b: 4, c: 1 + 2 − 1 (un-ticked in 2026 → cancelled) = 2
    expect(w.source).toBe('activity');
    expect(w.episodes).toBe(16);
    expect(w.minutes).toBe(16 * 50);
    expect(w.hours).toBe(13);
    expect(w.showCount).toBe(3);
  });

  it('ranks top shows and genres by episodes', () => {
    expect(w.topShows.map((s) => [s.entry.id, s.episodes])).toEqual([
      ['a', 10],
      ['b', 4],
      ['c', 2],
    ]);
    expect(w.topGenres[0]).toMatchObject({ genre: 'drama', episodes: 12 });
    expect(w.topGenres[0].share).toBeCloseTo(12 / 16);
    expect(w.genreCount).toBe(4);
  });

  it('finds started/finished, the best finish and first/last shows', () => {
    expect(w.started.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(w.finished.map((e) => e.id)).toEqual(['a', 'b']);
    expect(w.topRatedFinished?.id).toBe('a');
    expect(w.firstShow).toMatchObject({ day: '2025-01-03' });
    expect(w.firstShow?.entry.id).toBe('a');
    expect(w.lastShow?.entry.id).toBe('c');
    expect(w.lastShow?.day).toBe('2025-12-31');
  });

  it('computes binge, streak, month and weekday', () => {
    expect(w.biggestDay).toMatchObject({ day: '2025-01-04', episodes: 6, showCount: 1 });
    expect(w.biggestDay?.entry?.id).toBe('a');
    expect(w.bingeDays).toBe(1);
    expect(w.longestStreak).toEqual({ days: 3, from: '2025-01-03', to: '2025-01-05' });
    expect(w.busiestMonth).toEqual({ month: 0, episodes: 10 });
    expect(w.months[2]).toBe(4);
    expect(w.favouriteWeekday?.day).toBe(6); // Saturday
    expect(w.activeDays).toBe(7);
  });

  it('measures languages and night viewing', () => {
    expect(w.languages).toEqual(['de', 'en', 'ko']);
    expect(w.nonEnglishCount).toBe(2);
    expect(w.nonEnglishShare).toBeCloseTo(2 / 3);
    expect(w.hours24[23]).toBe(2);
    expect(w.nightShare).toBeGreaterThan(0);
  });
});

describe('computeWrapped (fallbacks)', () => {
  it('falls back to completed shows when the year has no episode history', () => {
    const entries = {
      x: entry('x', { status: 'completed', completedAt: '2023-04-10T12:00:00', rating: 8 }, { episodeCount: 20, runtime: 30, genres: ['comedy'] }),
      y: entry('y', { status: 'completed', completedAt: '2023-09-02T12:00:00' }, { episodeCount: 8, runtime: 60, genres: ['drama'] }),
      z: entry('z', { status: 'completed', completedAt: '2022-01-01T12:00:00' }),
    };
    const w = computeWrapped({ entries, activity: [] }, 2023);
    expect(w.source).toBe('completed');
    expect(w.episodes).toBe(28);
    expect(w.hours).toBe(Math.round((20 * 30 + 8 * 60) / 60));
    expect(w.topShows[0].entry.id).toBe('x');
    expect(w.finished).toHaveLength(2);
    expect(w.firstShow?.entry.id).toBe('x');
    expect(w.lastShow?.entry.id).toBe('y');
    expect(w.busiestMonth?.month).toBe(3);
    expect(w.biggestDay).toBeUndefined();
    expect(w.longestStreak).toBeUndefined();
    expect(w.favouriteWeekday).toBeUndefined();
    expect(w.topRatedFinished?.id).toBe('x');
    expect(w.persona.id).not.toBe('night-owl');
  });

  it('handles an empty year gracefully', () => {
    const w = computeWrapped({ entries: {}, activity: [] }, 2020);
    expect(w.source).toBe('empty');
    expect(w.episodes).toBe(0);
    expect(w.topShows).toEqual([]);
    expect(w.busiestMonth).toBeUndefined();
    expect(w.persona.id).toBe('fresh');
    expect(wrappedText(w, (g) => g)).toContain('quiet year');
  });
});

describe('years', () => {
  it('lists years with data and picks a sensible default', () => {
    const entries = { a: entry('a', { completedAt: '2024-03-01T12:00:00' }), b: entry('b') };
    const doc = { entries, activity: [...day('b', '2025-06-01', 12), ...day('b', '2026-01-02', 2, 20, 20)] };
    expect(wrappedYears(doc)).toEqual([2026, 2025, 2024]);
    expect(defaultWrappedYear(doc, new Date('2026-01-10T12:00:00'))).toBe(2025);
    expect(defaultWrappedYear(doc, new Date('2025-07-01T12:00:00'))).toBe(2025);
    expect(defaultWrappedYear({ entries: {}, activity: [] }, new Date('2026-01-10T12:00:00'))).toBe(2026);
  });
});

describe('persona rules', () => {
  const blank = computeWrapped({ entries: {}, activity: [] }, 2025);
  const mk = (o: Partial<typeof blank>) => pickPersona({ ...blank, source: 'activity', episodes: 40, showCount: 10, activeDays: 20, ...o });

  it('night owl when most episodes are late', () => expect(mk({ nightShare: 0.7 }).id).toBe('night-owl'));
  it('binger with many 5+ episode days', () => expect(mk({ bingeDays: 10 }).id).toBe('binger'));
  it('completionist with a high finish rate', () => {
    const fin = Array.from({ length: 8 }, (_, i) => entry(`f${i}`));
    expect(mk({ finished: fin }).id).toBe('completionist');
  });
  it('critic when nearly everything is rated', () => expect(mk({ ratedCount: 10 }).id).toBe('critic'));
  it('explorer with many genres or languages', () => expect(mk({ genreCount: 14, languages: ['en', 'ko', 'de', 'ja'] }).id).toBe('explorer'));
  it('loyalist with few shows and many episodes', () => expect(mk({ showCount: 2, episodes: 80 }).id).toBe('loyalist'));
  it('sampler otherwise', () => expect(mk({}).id).toBe('sampler'));
});

describe('demo library', () => {
  it('produces a full Wrapped for the last 12 months', () => {
    const now = new Date('2026-10-07T12:00:00');
    const doc = buildDemoDoc(now.getTime());
    const y = defaultWrappedYear(doc, now);
    expect(y).toBe(2026);
    const w = computeWrapped(doc, y);
    expect(w.source).toBe('activity');
    expect(w.episodes).toBeGreaterThan(50);
    expect(w.topShows).toHaveLength(5);
    expect(w.biggestDay?.episodes).toBeGreaterThan(2);
    expect(w.finished.length).toBeGreaterThan(2);
    expect(wrappedText(w, (g) => g)).toContain('Top shows');
  });
});
