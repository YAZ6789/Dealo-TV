import { describe, expect, it } from 'vitest';
import type { LibraryEntry, Recommendation, ShowSummary } from '../types';
import type { Collection } from './useCollections';
import { buildDeck, decideSwipe, dragProgress, outcomeLabel, RATE_FOR, remainingOf, tiltFor } from './SwipeDeck';

const show = (id: string): ShowSummary => ({ id, source: 'catalog', title: id, genres: [] });
const rec = (id: string, match = 80): Recommendation => ({ show: show(id), match, score: match / 100, reasons: [], seeds: [] });
const entry = (id: string, status: LibraryEntry['status'], rating?: number, completedAt = '2026-01-01'): LibraryEntry => ({
  id,
  show: show(id),
  status,
  rating,
  watched: {},
  addedAt: '',
  updatedAt: completedAt,
  completedAt,
});
const cols = (ids: string[], id: Collection['id'] = 'foryou'): Collection[] => [{ id, label: id, items: ids.map((x) => ({ show: show(x), rec: rec(x) })) }];

const W = 400;
const H = 600;

describe('dragProgress', () => {
  it('ignores tiny jitters', () => {
    expect(dragProgress(3, -2, W, H).dir).toBeNull();
  });
  it('picks the dominant axis and caps progress at 1', () => {
    expect(dragProgress(60, 10, W, H)).toEqual({ dir: 'right', p: 0.5 });
    expect(dragProgress(-500, 0, W, H)).toEqual({ dir: 'left', p: 1 });
    expect(dragProgress(5, -144, W, H)).toEqual({ dir: 'up', p: 1 });
    expect(dragProgress(0, 72, W, H).dir).toBe('down');
  });
});

describe('decideSwipe', () => {
  it('commits once dragged past the threshold', () => {
    expect(decideSwipe(130, 0, 0, 0, W, H)).toBe('right');
    expect(decideSwipe(-130, 20, 0, 0, W, H)).toBe('left');
    expect(decideSwipe(0, -150, 0, 0, W, H)).toBe('up');
    expect(decideSwipe(0, 150, 0, 0, W, H)).toBe('down');
  });
  it('springs back for short, slow drags', () => {
    expect(decideSwipe(60, 0, 0.1, 0, W, H)).toBeNull();
    expect(decideSwipe(0, -40, 0, -0.1, W, H)).toBeNull();
  });
  it('commits a short drag when flicked fast in the same direction', () => {
    expect(decideSwipe(60, 0, 1.2, 0, W, H)).toBe('right');
    expect(decideSwipe(-50, 0, -0.9, 0, W, H)).toBe('left');
    // flicking back against the drag does not commit
    expect(decideSwipe(60, 0, -1.2, 0, W, H)).toBeNull();
    // a flick from a barely-moved card does not commit
    expect(decideSwipe(15, 0, 2, 0, W, H)).toBeNull();
  });
});

describe('tiltFor', () => {
  it('rotates with the drag, clamps, and inverts when grabbed low', () => {
    expect(tiltFor(100, W, false)).toBeGreaterThan(0);
    expect(tiltFor(100, W, true)).toBeLessThan(0);
    expect(tiltFor(5000, W, false)).toBe(18);
    expect(tiltFor(-5000, W, false)).toBe(-18);
  });
});

describe('buildDeck', () => {
  it('Discover skips shows already in the library, blocked or swiped this session', () => {
    const entries = { a: entry('a', 'plan') };
    const deck = buildDeck('discover', cols(['a', 'b', 'c', 'd', 'b']), entries, { c: {} }, new Set(['d']));
    expect(deck.map((i) => i.show.id)).toEqual(['b']);
  });
  it('uses the matching shelf for binges / gems', () => {
    expect(buildDeck('binge', cols(['x', 'y'], 'binge'), {}, {}).map((i) => i.show.id)).toEqual(['x', 'y']);
    expect(buildDeck('gems', cols(['x'], 'binge'), {}, {})).toEqual([]);
  });
  it('Rate my watched lists finished, unrated shows — most recent first', () => {
    const entries = {
      a: entry('a', 'completed', undefined, '2025-01-01'),
      b: entry('b', 'completed', 8),
      c: entry('c', 'watching'),
      d: entry('d', 'completed', undefined, '2026-05-01'),
    };
    expect(buildDeck('rate', [], entries, {}).map((i) => i.show.id)).toEqual(['d', 'a']);
  });
});

describe('remainingOf', () => {
  it('drops swiped cards and cards decided elsewhere meanwhile', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ show: show(id) }));
    expect(remainingOf({ items, done: ['a'] }, 'discover', { b: entry('b', 'plan') }, {}).map((i) => i.show.id)).toEqual(['c']);
    const rate = { a: entry('a', 'completed'), b: entry('b', 'completed', 7), c: entry('c', 'completed') };
    expect(remainingOf({ items, done: ['c'] }, 'rate', rate, {}).map((i) => i.show.id)).toEqual(['a']);
  });
});

describe('labels', () => {
  it('describes outcomes per mode', () => {
    expect(outcomeLabel('discover', 'right')).toBe('Saved');
    expect(outcomeLabel('gems', 'up', 8)).toBe('Seen · 8/10');
    expect(outcomeLabel('rate', 'down')).toBe(`Rated ${RATE_FOR.down}/10`);
    expect(RATE_FOR).toEqual({ right: 9, left: 3, up: 10, down: 6 });
  });
});
