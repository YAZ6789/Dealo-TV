import { describe, expect, it } from 'vitest';
import type { LibraryEntry, Recommendation, ShowSummary } from '../types';
import { layoutSky, R } from './constellationLayout';

const show = (id: string, genres: ShowSummary['genres']): ShowSummary => ({ id, source: 'catalog', title: id, genres });
const entry = (id: string, genres: ShowSummary['genres'], rating?: number): LibraryEntry => ({
  id,
  show: show(id, genres),
  status: 'completed',
  rating,
  watched: {},
  addedAt: '',
  updatedAt: '',
});
const rec = (id: string, genres: ShowSummary['genres'], match: number, because?: string): Recommendation => ({
  show: show(id, genres),
  match,
  score: match / 100,
  seeds: [],
  reasons: because ? [{ kind: 'because', label: '', ref: because, weight: 1 }] : [],
});

describe('layoutSky', () => {
  const entries = [entry('bb', ['crime', 'drama'], 10), entry('meh', ['crime'], 3), entry('office', ['comedy'], 8)];
  const recs = [rec('bcs', ['crime'], 97, 'bb'), rec('far', ['crime'], 40), rec('ted', ['comedy'], 80, 'office')];
  const sky = layoutSky(entries, recs);
  const dist = (id: string) => {
    const n = sky.nodes.find((x) => x.id === id)!;
    return Math.hypot(n.x, n.y) / R;
  };

  it('puts loved library shows closer than disliked ones, and inside the split', () => {
    expect(dist('bb')).toBeLessThan(dist('meh'));
    expect(dist('meh')).toBeLessThan(sky.split + 0.02);
  });

  it('puts better matches closer, outside the library zone', () => {
    expect(dist('bcs')).toBeLessThan(dist('far'));
    expect(dist('bcs')).toBeGreaterThan(sky.split);
  });

  it('builds genre sectors and links recs to their seeds', () => {
    expect(sky.sectors.map((s) => s.key)).toEqual(['crime', 'comedy']);
    expect(sky.links).toContainEqual({ from: 'bb', to: 'bcs' });
    expect(sky.links).toHaveLength(2);
  });

  it('is deterministic and keeps nodes apart', () => {
    const again = layoutSky(entries, recs);
    expect(again.nodes.map((n) => [n.x, n.y])).toEqual(sky.nodes.map((n) => [n.x, n.y]));
    for (const a of sky.nodes)
      for (const b of sky.nodes) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(Math.min(a.r, b.r));
  });
});
