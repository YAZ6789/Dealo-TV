import { describe, expect, it } from 'vitest';
import { cellToString, columnLetter, detectHeaderRow, parseCsv } from './table';

describe('columnLetter', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('%i → %s', (i, s) => expect(columnLetter(i)).toBe(s));
});

describe('cellToString', () => {
  it('coerces values', () => {
    expect(cellToString(null)).toBe('');
    expect(cellToString(undefined)).toBe('');
    expect(cellToString('  hi ')).toBe('hi');
    expect(cellToString(8)).toBe('8');
    expect(cellToString(0.1 + 0.2)).toBe('0.3');
    expect(cellToString(true)).toBe('TRUE');
    expect(cellToString(false)).toBe('FALSE');
    expect(cellToString(new Date(Date.UTC(2024, 0, 15)))).toBe('2024-01-15');
    expect(cellToString(NaN)).toBe('');
  });
});

describe('parseCsv', () => {
  it('parses a simple CSV with a header', () => {
    const t = parseCsv('Title,Status,Rating\nDark,Watched,9\n"Law & Order, SVU",Watching,7\n');
    expect(t.headers).toEqual(['Title', 'Status', 'Rating']);
    expect(t.rows).toEqual([
      ['Dark', 'Watched', '9'],
      ['Law & Order, SVU', 'Watching', '7'],
    ]);
  });

  it('strips a BOM, trims cells, skips empty lines and trailing empty columns', () => {
    const t = parseCsv('﻿Show , Status,,\n\n  Dark ,  Watched ,,\n,,,\nLost,Dropped,,\n');
    expect(t.headers).toEqual(['Show', 'Status']);
    expect(t.rows).toEqual([
      ['Dark', 'Watched'],
      ['Lost', 'Dropped'],
    ]);
  });

  it('auto-detects TSV', () => {
    const t = parseCsv('Show\tStatus\nDark\tWatched\nLost\tDropped');
    expect(t.headers).toEqual(['Show', 'Status']);
    expect(t.rows[1]).toEqual(['Lost', 'Dropped']);
  });

  it('skips a title banner row above the real header', () => {
    const t = parseCsv('My TV Shows 2024,,,\n,,,\nShow,Status,Season,Rating\nDark,Watched,3,9\nLost,Dropped,3,6\n');
    expect(t.headers).toEqual(['Show', 'Status', 'Season', 'Rating']);
    expect(t.rows).toHaveLength(2);
  });

  it('synthesizes headers for headerless data (number in data position)', () => {
    const t = parseCsv('Breaking Bad,Watched,10\nThe Wire,Watched,9\nLost,Dropped,6\n');
    expect(t.headers).toEqual(['Column A', 'Column B', 'Column C']);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toEqual(['Breaking Bad', 'Watched', '10']);
  });

  it('synthesizes headers for a headerless list with emoji statuses', () => {
    const t = parseCsv('Breaking Bad,✅\nSeverance,🔴\nThe Bear,\nEmily in Paris,❌\n');
    expect(t.headers).toEqual(['Column A', 'Column B']);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[2]).toEqual(['The Bear', '']);
  });

  it('treats a single-column list of titles as headerless', () => {
    const t = parseCsv('Breaking Bad\nThe Wire\nDark\n');
    expect(t.headers).toEqual(['Column A']);
    expect(t.rows).toHaveLength(3);
  });

  it('keeps a single-column header when it is a known column name', () => {
    const t = parseCsv('Shows\nBreaking Bad\nThe Wire\n');
    expect(t.headers).toEqual(['Shows']);
    expect(t.rows).toHaveLength(2);
  });

  it('accepts an unknown-word header that sits above typed data', () => {
    const t = parseCsv('Thing,Points,When\nDark,9,2024-01-02\nLost,6,2010-05-23\n');
    expect(t.headers).toEqual(['Thing', 'Points', 'When']);
    expect(t.rows).toHaveLength(2);
  });

  it('does not treat a data row with a status word as a header', () => {
    const t = parseCsv('Breaking Bad,Watched\nThe Wire,Watching\n');
    expect(t.headers).toEqual(['Column A', 'Column B']);
    expect(t.rows).toHaveLength(2);
  });

  it('makes headers unique and non-empty', () => {
    const t = parseCsv('Show,,Notes,Notes\nDark,x,a,b\n');
    expect(t.headers).toEqual(['Show', 'Column B', 'Notes', 'Notes (2)']);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('\n\n,,\n')).toEqual({ headers: [], rows: [] });
  });

  it('pads ragged rows', () => {
    const t = parseCsv('Show,Status,Rating\nDark\nLost,Dropped,6,extra\n');
    expect(t.headers).toEqual(['Show', 'Status', 'Rating', 'Column D']);
    expect(t.rows[0]).toEqual(['Dark', '', '', '']);
  });
});

describe('detectHeaderRow', () => {
  it('accepts non-string matrices', () => {
    const t = detectHeaderRow([
      ['Title', 'Rating', 'Seen'],
      ['Dark', 9, true],
      [null, undefined, ''],
    ]);
    expect(t.headers).toEqual(['Title', 'Rating', 'Seen']);
    expect(t.rows).toEqual([['Dark', '9', 'TRUE']]);
  });

  it('finds a header a few rows down after banner rows', () => {
    const t = detectHeaderRow([
      ['TV tracker'],
      ['last updated', ''],
      ['Name', 'Progress', 'Platform'],
      ['Shogun', 'S1E5', 'Hulu'],
    ]);
    expect(t.headers).toEqual(['Name', 'Progress', 'Platform']);
    expect(t.rows).toEqual([['Shogun', 'S1E5', 'Hulu']]);
  });
});
