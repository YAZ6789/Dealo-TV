import { describe, expect, it } from 'vitest';
import {
  columnStats,
  detectColumns,
  detectRatingScale,
  headerRoleScores,
  inferRatingScale,
  mappingFromHeaders,
  mappingToHeaders,
  normalizeStatus,
  parseBool,
  parseCount,
  parseDate,
  parseProgress,
  parseRating,
  parseYear,
} from './mapping';
import type { Table } from './table';

describe('normalizeStatus', () => {
  it.each([
    ['Watched', 'completed'],
    ['done', 'completed'],
    ['FINISHED', 'completed'],
    ['Completed!', 'completed'],
    ['seen', 'completed'],
    ['✓', 'completed'],
    ['✔', 'completed'],
    ['✅', 'completed'],
    ['x', 'completed'],
    ['X', 'completed'],
    ['yes', 'completed'],
    ['Watching', 'watching'],
    ['currently watching', 'watching'],
    ['In Progress', 'watching'],
    ['current', 'watching'],
    ['started', 'watching'],
    ['Ongoing', 'watching'],
    ['caught up', 'watching'],
    ['Caught up?', 'watching'],
    ['airing', 'watching'],
    ['Rewatching', 'watching'],
    ['🔴', 'watching'],
    ['🔴 Watching', 'watching'],
    ['Want to watch', 'plan'],
    ['to watch', 'plan'],
    ['Plan to Watch', 'plan'],
    ['planned', 'plan'],
    ['Watchlist', 'plan'],
    ['queue', 'plan'],
    ['later', 'plan'],
    ['next', 'plan'],
    ['maybe', 'plan'],
    ['TODO', 'plan'],
    ['not started', 'plan'],
    ['⏳', 'plan'],
    ['On Hold', 'on_hold'],
    ['on-hold', 'on_hold'],
    ['hold', 'on_hold'],
    ['Paused', 'on_hold'],
    ['pause', 'on_hold'],
    ['break', 'on_hold'],
    ['waiting', 'on_hold'],
    ['Waiting for new season', 'on_hold'],
    ['stopped for now', 'on_hold'],
    ['Dropped', 'dropped'],
    ['quit', 'dropped'],
    ['stopped', 'dropped'],
    ['abandoned', 'dropped'],
    ['gave up', 'dropped'],
    ["didn't finish", 'dropped'],
    ['DNF', 'dropped'],
    ['Dropped - too slow', 'dropped'],
    ['Not interested', 'blocked'],
    ['never', 'blocked'],
    ['no', 'blocked'],
    ['hate', 'blocked'],
    ['skip', 'blocked'],
    ["don't recommend", 'blocked'],
    ['nope', 'blocked'],
    ['❌', 'blocked'],
    ['✅ Watched', 'completed'],
    ['watched (twice)', 'completed'],
  ])('%s → %s', (v, out) => {
    expect(normalizeStatus(v)).toBe(out);
  });
  it.each(['', '   ', 'Breaking Bad', 'nobody', 'xyz', 'yesterday', '8/10'])('%j → undefined', (v) => {
    expect(normalizeStatus(v)).toBeUndefined();
  });
  it('handles null/undefined', () => {
    expect(normalizeStatus(undefined)).toBeUndefined();
    expect(normalizeStatus(null)).toBeUndefined();
  });
});

describe('parseProgress', () => {
  it.each([
    ['S2E5', { season: 2, episode: 5 }],
    ['s02e05', { season: 2, episode: 5 }],
    ['S2 E5', { season: 2, episode: 5 }],
    ['S2 Ep5', { season: 2, episode: 5 }],
    ['S2 Ep. 5', { season: 2, episode: 5 }],
    ['2x05', { season: 2, episode: 5 }],
    ['Season 2 Episode 5', { season: 2, episode: 5 }],
    ['Season 2, Ep 5', { season: 2, episode: 5 }],
    ['season 10 episode 120', { season: 10, episode: 120 }],
    ['up to S3E1 (finale next)', { season: 3, episode: 1 }],
    ['S3', { season: 3, episode: 0 }],
    ['Season 4', { season: 4, episode: 0 }],
    ['E5', { season: 1, episode: 5 }],
    ['Ep 5', { season: 1, episode: 5 }],
    ['Episode 5', { season: 1, episode: 5 }],
    ['5/10', { season: 1, episode: 5 }],
  ])('%s', (v, out) => {
    expect(parseProgress(v)).toEqual(out);
  });
  it.each(['2.5', '5', '', 'Breaking Bad', '12/10', 'Lost', 'Sense8', 'Watched', 'S0'])('%j → undefined', (v) => {
    expect(parseProgress(v)).toBeUndefined();
  });
});

describe('parseCount', () => {
  it.each([
    ['2', 2],
    ['S2', 2],
    ['Season 3', 3],
    ['Ep. 7', 7],
    ['4.0', 4],
    ['#5', 5],
    ['two', undefined],
    ['', undefined],
  ])('%j → %j', (v, out) => expect(parseCount(v)).toBe(out));
});

describe('parseRating', () => {
  it.each([
    ['8', undefined, 8],
    ['8.5', undefined, 8.5],
    ['8,5', undefined, 8.5],
    ['8.3', undefined, 8.5],
    ['8/10', undefined, 8],
    ['4/5', undefined, 8],
    ['3.5/5', undefined, 7],
    ['4 out of 5', undefined, 8],
    ['★★★★☆', undefined, 8],
    ['★★★½', undefined, 7],
    ['⭐⭐⭐', undefined, 6],
    ['4.5 stars', undefined, 9],
    ['4 stars', undefined, 8],
    ['85%', undefined, 8.5],
    ['85', undefined, 8.5],
    ['4', 5, 8],
    ['5', 5, 10],
    ['72', 100, 7],
    ['0.5', 5, 1],
    ['10', 10, 10],
  ] as const)('%s (scale %s) → %s', (v, scale, out) => {
    expect(parseRating(v, scale)).toBe(out);
  });
  it.each(['', 'A-', 'B+', 'great', '0', '11/10', '6', '120%'])('%j → undefined', (v) => {
    expect(parseRating(v, v === '6' ? 5 : undefined)).toBeUndefined();
  });
});

describe('inferRatingScale / detectRatingScale', () => {
  it('infers from the max plain number', () => {
    expect(inferRatingScale(['3', '4', '5', ''])).toBe(5);
    expect(inferRatingScale(['3', '7.5', '9'])).toBe(10);
    expect(inferRatingScale(['70', '85'])).toBe(100);
    expect(inferRatingScale(['8/10', 'great'])).toBe(10);
    expect(inferRatingScale([])).toBe(10);
  });
  it('uses header hints', () => {
    expect(detectRatingScale('My Score (out of 5)', ['3', '4'])).toBe(5);
    expect(detectRatingScale('Rating /10', ['3', '4'])).toBe(10);
    expect(detectRatingScale('Stars', ['3'])).toBe(5);
    expect(detectRatingScale('Score %', ['3'])).toBe(100);
    expect(detectRatingScale('Rating', ['3', '4'])).toBe(5);
  });
});

describe('parseBool', () => {
  it.each([
    ['TRUE', true],
    ['true', true],
    ['Yes', true],
    ['y', true],
    ['1', true],
    ['x', true],
    ['✓', true],
    ['✔', true],
    ['✅', true],
    ['watched', true],
    ['FALSE', false],
    ['no', false],
    ['N', false],
    ['0', false],
    ['❌', false],
    ['-', false],
    ['', undefined],
    ['maybe', undefined],
    ['Breaking Bad', undefined],
  ])('%j → %j', (v, out) => expect(parseBool(v)).toBe(out));
});

describe('parseDate', () => {
  it.each([
    ['2024-01-15', '2024-01-15'],
    ['2024-1-5', '2024-01-05'],
    ['2024-01-15T10:30:00Z', '2024-01-15'],
    ['2024/01/15', '2024-01-15'],
    ['1/15/2024', '2024-01-15'],
    ['01/02/2024', '2024-01-02'],
    ['15/01/2024', '2024-01-15'],
    ['1/15/24', '2024-01-15'],
    ['15.01.2024', '2024-01-15'],
    ['5.3.2023', '2023-03-05'],
    ['Jan 5, 2024', '2024-01-05'],
    ['January 5th 2024', '2024-01-05'],
    ['Sept 30, 2023', '2023-09-30'],
    ['5 Jan 2024', '2024-01-05'],
    ['5 January, 2024', '2024-01-05'],
    ['March 2022', '2022-03-01'],
    ['Date(2024,0,15)', '2024-01-15'],
    ['45306', '2024-01-15'],
    ['45306.5', '2024-01-15'],
  ])('%s → %s', (v, out) => expect(parseDate(v)).toBe(out));
  it.each(['', '2024', '8', '13/13/2024', '2024-02-30', 'yesterday', 'Breaking Bad', '19999', '99999', 'Lost 2004'])(
    '%j → undefined',
    (v) => expect(parseDate(v)).toBeUndefined(),
  );
});

describe('parseYear', () => {
  it('finds a plausible year', () => {
    expect(parseYear('2019')).toBe(2019);
    expect(parseYear('2019–2022')).toBe(2019);
    expect(parseYear('(1999)')).toBe(1999);
    expect(parseYear('2019-03-01')).toBe(2019);
    expect(parseYear('12345')).toBeUndefined();
    expect(parseYear('')).toBeUndefined();
  });
});

describe('headerRoleScores', () => {
  it('matches exact synonyms strongly', () => {
    expect(headerRoleScores('Title').title).toBe(1);
    expect(headerRoleScores('Show').title).toBe(1);
    expect(headerRoleScores('Status').status).toBe(1);
    expect(headerRoleScores('Season #').season).toBe(1);
    expect(headerRoleScores('Ep #').episode).toBe(1);
    expect(headerRoleScores('IMDb ID').imdbId).toBe(1);
    expect(headerRoleScores('Temporada').season).toBe(1);
    expect(headerRoleScores('Título').title).toBe(1);
  });
  it('matches contained synonyms more weakly', () => {
    const s = headerRoleScores('My Score (out of 5)');
    expect(s.rating).toBeGreaterThan(0.6);
    expect(s.rating).toBeLessThan(1);
    expect(headerRoleScores('Date finished').finishedAt).toBe(1);
    expect(headerRoleScores('Watched?').watchedFlag).toBe(1);
  });
  it('recognises symbol headers', () => {
    expect(headerRoleScores('❤').favorite).toBeGreaterThan(0.8);
    expect(headerRoleScores('✓').watchedFlag).toBeGreaterThan(0.8);
  });
  it('ignores short synonyms inside longer headers', () => {
    expect(headerRoleScores('Season count').season).toBeGreaterThan(0);
    expect(headerRoleScores('Column A').title).toBeUndefined();
    expect(headerRoleScores('Breaking Bad')).toEqual({});
  });
});

describe('columnStats', () => {
  it('computes ratios over non-empty values', () => {
    const s = columnStats(['S1E2', 'S3E4', '', 'nope']);
    expect(s.n).toBe(3);
    expect(s.progress).toBeCloseTo(2 / 3);
  });
});

const t = (headers: string[], rows: string[][]): Table => ({ headers, rows });

describe('detectColumns', () => {
  it('layout (a): Show | Status | Season | Episode | Rating | Notes', () => {
    const table = t(
      ['Show', 'Status', 'Season', 'Episode', 'Rating', 'Notes'],
      [
        ['Breaking Bad', 'Watched', '5', '16', '10', 'Masterpiece'],
        ['Severance', 'Watching', '2', '3', '9', ''],
        ['The Bear', 'Plan to watch', '', '', '', 'Everyone says it is great'],
        ['Lost', 'Dropped', '3', '7', '6', 'lost me'],
      ],
    );
    const { mapping, confidence } = detectColumns(table);
    expect(mapping).toEqual({ title: 0, status: 1, season: 2, episode: 3, rating: 4, notes: 5 });
    expect(confidence.title).toBeGreaterThan(0.8);
  });

  it('layout (b): Title | Watched? | My Score (out of 5) | Date finished', () => {
    const table = t(
      ['Title', 'Watched? (TRUE/FALSE)', 'My Score (out of 5)', 'Date finished'],
      [
        ['Fleabag', 'TRUE', '5', '3/2/2020'],
        ['Succession', 'TRUE', '4.5', '5/30/2023'],
        ['Andor', 'FALSE', '', ''],
      ],
    );
    const { mapping } = detectColumns(table);
    expect(mapping).toEqual({ title: 0, watchedFlag: 1, rating: 2, finishedAt: 3 });
  });

  it('layout (c): headerless titles + emoji statuses', () => {
    const table = t(
      ['Column A', 'Column B'],
      [
        ['Breaking Bad', '✅'],
        ['Severance', '🔴'],
        ['The Bear', '⏳'],
        ['Emily in Paris', '❌'],
        ['Dark', '✅'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({ title: 0, status: 1 });
  });

  it('layout (d): Name | Progress | Platform', () => {
    const table = t(
      ['Name', 'Progress', 'Platform'],
      [
        ['Shogun', 'S1E5', 'Hulu'],
        ['The Boys', 'S4E2', 'Prime Video'],
        ['Slow Horses', 'S3E6', 'Apple TV+'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({ title: 0, progress: 1, platform: 2 });
  });

  it('content sniffs progress/status/imdb/year without useful headers', () => {
    const table = t(
      ['Column A', 'Column B', 'Column C', 'Column D', 'Column E'],
      [
        ['tt0903747', 'Breaking Bad', '2008', 'S5E16', 'watched'],
        ['tt11280740', 'Severance', '2022', 'S2E3', 'watching'],
        ['tt0411008', 'Lost', '2004', 'S3E1', 'dropped'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({ imdbId: 0, title: 1, year: 2, progress: 3, status: 4 });
  });

  it('a "Category" column holding genres maps to genre, not status', () => {
    const table = t(
      ['Show', 'Category'],
      [
        ['Dark', 'Sci-Fi'],
        ['Fleabag', 'Comedy'],
        ['Mindhunter', 'Crime drama'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({ title: 0, genre: 1 });
  });

  it('a "List" column with statuses maps to status', () => {
    const table = t(
      ['Series', 'List'],
      [
        ['Dark', 'Watched'],
        ['Fleabag', 'To watch'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({ title: 0, status: 1 });
  });

  it('a "Progress" column holding statuses becomes status', () => {
    const table = t(
      ['Show', 'Progress'],
      [
        ['Dark', 'Completed'],
        ['Lost', 'Watching'],
        ['Fargo', 'Plan to watch'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({ title: 0, status: 1 });
  });

  it('always guesses a title, preferring distinct alphabetic text', () => {
    const table = t(
      ['#', 'Thing', 'Score'],
      [
        ['1', 'Breaking Bad', '9'],
        ['2', 'The Wire', '10'],
        ['3', 'Six Feet Under', '8'],
      ],
    );
    const { mapping, confidence } = detectColumns(table);
    expect(mapping.title).toBe(1);
    expect(mapping.rating).toBe(2);
    expect(confidence.title).toBeLessThanOrEqual(0.7);
  });

  it('single-column tables map to title', () => {
    expect(detectColumns(t(['Column A'], [['Dark'], ['Lost']])).mapping).toEqual({ title: 0 });
  });

  it('notes-like long text does not beat the title column', () => {
    const table = t(
      ['Column A', 'Column B'],
      [
        ['Dark', 'A German family saga with time travel that rewards close attention and patience'],
        ['Lost', 'Plane crash survivors on a mysterious island; started great but the ending divided fans'],
      ],
    );
    expect(detectColumns(table).mapping.title).toBe(0);
  });

  it('handles empty tables', () => {
    expect(detectColumns(t([], [])).mapping).toEqual({});
  });

  it('maps favorites, dates, tmdb ids', () => {
    const table = t(
      ['Show name', 'Fav', 'Started', 'Finished', 'TMDB ID', 'Network'],
      [
        ['Dark', '❤', '2020-01-01', '2020-02-01', '70523', 'Netflix'],
        ['Lost', '', '2010-01-01', '', '4607', 'ABC'],
      ],
    );
    expect(detectColumns(table).mapping).toEqual({
      title: 0,
      favorite: 1,
      startedAt: 2,
      finishedAt: 3,
      tmdbId: 4,
      platform: 5,
    });
  });
});

describe('mapping persistence helpers', () => {
  it('round-trips through header names', () => {
    const a = t(['Show', 'Status', 'Rating'], []);
    const b = t(['Rating', 'Show', 'Extra', 'Status'], []);
    const saved = mappingToHeaders(a, { title: 0, status: 1, rating: 2 });
    expect(saved).toEqual({ title: 'Show', status: 'Status', rating: 'Rating' });
    expect(mappingFromHeaders(b, saved)).toEqual({ title: 1, status: 3, rating: 0 });
    expect(mappingFromHeaders(t(['X'], []), saved)).toEqual({});
  });
});
