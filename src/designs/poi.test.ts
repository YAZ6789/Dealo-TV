import { describe, expect, it } from 'vitest';
import { buildSections, camFor, cutFrames, kindOf, lastSeen, nextFeed, resolveSubject, seasonLog, ssnFor, timecodeFor, wallColumns, type Box } from './poi/logic';
import type { Collection } from './useCollections';

const show = (id: string) => ({ show: { id, title: id, genres: [], source: 'catalog' } }) as unknown as Collection['items'][number];

describe('poi ids', () => {
  it('makes stable, well-formed SSN / camera / timecode strings', () => {
    expect(ssnFor('cat:severance')).toBe(ssnFor('cat:severance'));
    expect(ssnFor('cat:severance')).toMatch(/^\d{3}-\d{2}-\d{4}$/);
    expect(ssnFor('cat:severance')).not.toBe(ssnFor('cat:dark'));
    for (let i = 0; i < 500; i++) expect(ssnFor(`x${i}`)).not.toMatch(/^(000|666)-/);
    expect(camFor('a')).toMatch(/^CAM-\d{3}$/);
    expect(timecodeFor('a')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(timecodeFor('a', 86400)).toBe(timecodeFor('a'));
  });
});

describe('kindOf / buildSections', () => {
  it('maps statuses to the Machine vocabulary', () => {
    expect(kindOf({ entry: { status: 'completed' } })).toBe('closed');
    expect(kindOf({ entry: { status: 'watching' } })).toBe('active');
    expect(kindOf({ entry: { status: 'plan' } })).toBe('incoming');
    expect(kindOf({})).toBe('suggest');
  });
  it('orders library first (watched, watching, watchlist, on hold) and recommendations last', () => {
    const cols: Collection[] = [
      { id: 'foryou', label: '', items: [show('r')] },
      { id: 'continue', label: '', items: [show('w')] },
      { id: 'watched', label: '', items: [show('c')] },
      { id: 'gems', label: '', items: [show('g')] },
      { id: 'watchlist', label: '', items: [show('p')] },
    ];
    expect(buildSections(cols).map((s) => s.id)).toEqual(['closed', 'active', 'incoming', 'suggest']);
  });
});

describe('cutFrames', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map(show);
  it('never includes the subject and returns distinct frames', () => {
    const f = cutFrames(pool, 'c', 2);
    expect(f).toHaveLength(2);
    expect(f.some((x) => x.show.id === 'c')).toBe(false);
    expect(new Set(f.map((x) => x.show.id)).size).toBe(2);
  });
  it('copes with tiny walls', () => {
    expect(cutFrames([show('a')], 'a', 2)).toEqual([]);
    expect(cutFrames([show('a'), show('b')], 'a', 2).map((x) => x.show.id)).toEqual(['b']);
  });
});

describe('seasonLog / lastSeen', () => {
  it('builds a per-episode grid', () => {
    const rows = seasonLog({ status: 'watching', watched: { 1: [1, 2, 3], 2: [1] }, seasonSizes: [3, 4] });
    expect(rows.map((r) => r.watched)).toEqual([3, 1]);
    expect(rows[1].eps).toEqual([true, false, false, false]);
  });
  it('fills a completed show with no episode data, and uses imported positions', () => {
    expect(seasonLog({ status: 'completed', watched: {}, seasonSizes: [2, 2] }).every((r) => r.watched === 2)).toBe(true);
    expect(seasonLog({ status: 'watching', watched: {}, position: { season: 2, episode: 1 }, seasonSizes: [2, 2] }).map((r) => r.watched)).toEqual([2, 1]);
    expect(lastSeen({ status: 'watching', watched: { 1: [1, 2], 2: [3] }, seasonSizes: [2, 5] })).toEqual({ season: 2, episode: 3 });
    expect(lastSeen({ status: 'completed', watched: {}, seasonSizes: [8, 10] })).toEqual({ season: 2, episode: 10 });
    expect(lastSeen({ status: 'plan', watched: {} })).toBeUndefined();
  });
});

describe('nextFeed', () => {
  // two rows of three, then a row of two (a different section)
  const grid: Box[] = [
    { x: 0, y: 0, w: 100, h: 150 },
    { x: 110, y: 0, w: 100, h: 150 },
    { x: 220, y: 0, w: 100, h: 150 },
    { x: 0, y: 160, w: 100, h: 150 },
    { x: 110, y: 160, w: 100, h: 150 },
    { x: 220, y: 160, w: 100, h: 150 },
    { x: 0, y: 400, w: 160, h: 240 },
    { x: 170, y: 400, w: 160, h: 240 },
  ];
  it('moves in reading order left/right and clamps at the ends', () => {
    expect(nextFeed(grid, 0, 'ArrowRight')).toBe(1);
    expect(nextFeed(grid, 0, 'ArrowLeft')).toBe(0);
    expect(nextFeed(grid, 7, 'ArrowRight')).toBe(7);
  });
  it('moves to the nearest feed in the next row up or down', () => {
    expect(nextFeed(grid, 1, 'ArrowDown')).toBe(4);
    expect(nextFeed(grid, 4, 'ArrowUp')).toBe(1);
    expect(nextFeed(grid, 5, 'ArrowDown')).toBe(7);
    expect(nextFeed(grid, 6, 'ArrowUp')).toBe(3);
    expect(nextFeed(grid, 0, 'ArrowUp')).toBe(0);
  });
  it('handles empty and out-of-range input', () => {
    expect(nextFeed([], 0, 'ArrowDown')).toBe(-1);
    expect(nextFeed(grid, -1, 'ArrowDown')).toBe(0);
  });
});

describe('wallColumns', () => {
  it('is 2 columns on phones and more on wide or short screens', () => {
    expect(wallColumns(360, 740)).toBe(2);
    expect(wallColumns(430, 932)).toBe(2);
    expect(wallColumns(768, 1024)).toBe(3);
    expect(wallColumns(1440, 900)).toBe(5);
    expect(wallColumns(1920, 1080)).toBe(6);
    expect(wallColumns(844, 390)).toBe(4);
  });
});

describe('resolveSubject', () => {
  const secs = [
    { id: 'closed' as const, items: [show('a'), show('b')] },
    { id: 'active' as const, items: [show('c')] },
    { id: 'suggest' as const, items: [show('b'), show('d')] },
  ];
  it('finds the subject, preferring the section it was opened from', () => {
    expect(resolveSubject(secs, 'b')).toMatchObject({ sid: 'closed', index: 1 });
    expect(resolveSubject(secs, 'b', 'suggest')).toMatchObject({ sid: 'suggest', index: 0 });
    expect(resolveSubject(secs, 'c', 'closed')).toMatchObject({ sid: 'active', index: 0 });
  });
  it('falls back to a snapshot and ignores unknown or empty ids', () => {
    expect(resolveSubject(secs, 'zz')).toBeNull();
    expect(resolveSubject(secs, null)).toBeNull();
    expect(resolveSubject(secs, 'x', 'closed', [show('x')])).toMatchObject({ index: 0, sid: 'closed' });
  });
});
