import { describe, expect, it } from 'vitest';
import { computeBadges, streakStatus } from './badges';
import { computeStats } from './compute';
import { buildDemoDoc } from '../lib/demo';
import type { LibraryDoc } from '../types';

const empty: Pick<LibraryDoc, 'entries' | 'activity' | 'blocked'> = { entries: {}, activity: [], blocked: {} };

describe('computeBadges', () => {
  it('locks everything for an empty library', () => {
    const b = computeBadges(empty, computeStats(empty));
    expect(b.every((x) => x.tier === 0)).toBe(true);
    expect(b.every((x) => x.progress === 0 && x.next === x.tiers[0])).toBe(true);
  });

  it('awards tiers from the demo library and sorts earned first', () => {
    const doc = buildDemoDoc();
    const b = computeBadges(doc, computeStats(doc));
    expect(b.some((x) => x.tier > 0)).toBe(true);
    for (let i = 1; i < b.length; i++) expect(b[i - 1].tier).toBeGreaterThanOrEqual(b[i].tier);
    for (const x of b) {
      expect(x.progress).toBeGreaterThanOrEqual(0);
      expect(x.progress).toBeLessThanOrEqual(1);
      if (x.tier === 3) expect(x.next).toBeUndefined();
      else expect(x.value).toBeLessThan(x.next!);
    }
  });

  it('counts late-night ticks for Night Owl', () => {
    const at = (h: number, m: number) => new Date(2026, 0, 5, h, m).toISOString();
    const activity = [1, 2, 3, 4, 2, 23].map((h, i) => ({ kind: 'episode' as const, id: 'x', season: 1, episode: i + 1, at: at(h, i * 7) }));
    const doc = { ...empty, activity };
    const night = computeBadges(doc, computeStats(doc)).find((x) => x.id === 'night')!;
    expect(night.value).toBe(5);
    expect(night.tier).toBe(1);
  });

  it('ignores un-ticked episodes and counts a bulk tick once', () => {
    const at = new Date(2026, 0, 5, 1, 0, 0).toISOString();
    const bulk = Array.from({ length: 40 }, (_, i) => ({ kind: 'episode' as const, id: 'y', season: 1, episode: i + 1, at }));
    const undo = { kind: 'unepisode' as const, id: 'y', season: 1, episode: 1, at: new Date(2026, 0, 5, 1, 5).toISOString() };
    const doc = { ...empty, activity: [...bulk, undo] };
    expect(computeBadges(doc, computeStats(doc)).find((x) => x.id === 'night')!.value).toBe(1);
  });
});

describe('streakStatus', () => {
  it('flags a streak that has not been extended today', () => {
    const now = new Date(2026, 4, 10, 20);
    const at = (d: number) => new Date(2026, 4, d, 21).toISOString();
    const doc = { ...empty, activity: [8, 9].map((d, i) => ({ kind: 'episode' as const, id: 'x', season: 1, episode: i + 1, at: at(d) })) };
    expect(streakStatus(computeStats(doc, now), now)).toBe('at-risk');
    const doc2 = { ...doc, activity: [...doc.activity, { kind: 'episode' as const, id: 'x', season: 1, episode: 9, at: new Date(2026, 4, 10, 8).toISOString() }] };
    expect(streakStatus(computeStats(doc2, now), now)).toBe('safe');
    expect(streakStatus(computeStats(empty, now), now)).toBe('none');
  });
});
