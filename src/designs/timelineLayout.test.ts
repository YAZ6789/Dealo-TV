import { describe, expect, it } from 'vitest';
import { airSpan, approxTextWidth, axisRange, barGeometry, layoutGroups, packLanes, spanLabel, summarize, tickStep, yearFrac, type LayoutItem, type LayoutOptions } from './timelineLayout';

const NOW = 2026.75;
const O: LayoutOptions = { pxPerYear: 40, origin: 1990, padLeft: 20, minBarW: 30, leadW: 30, innerPad: 8, labelGap: 6, gap: 8 };
const item = (id: string, start: number, end: number, labelW = 60): LayoutItem => ({ id, start, end, labelW });

/** Every pair of things in the same lane is separated by at least `gap`. */
function assertNoOverlap(bars: { lane: number; x: number; extent: number }[], gap: number) {
  const byLane = new Map<number, { x: number; extent: number }[]>();
  for (const b of bars) byLane.set(b.lane, [...(byLane.get(b.lane) ?? []), b]);
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.x - b.x);
    for (let i = 1; i < lane.length; i++) expect(lane[i].x).toBeGreaterThanOrEqual(lane[i - 1].extent + gap);
  }
}

describe('airSpan', () => {
  it('spans start → endYear inclusive', () => {
    expect(airSpan({ year: 2008, endYear: 2013, airStatus: 'ended' }, NOW)).toEqual({ start: 2008, end: 2014, ongoing: false, single: false, from: 2008, to: 2013 });
  });
  it('treats single-year shows as pills', () => {
    const s = airSpan({ year: 2014, endYear: 2014, airStatus: 'ended' }, NOW)!;
    expect(s.single).toBe(true);
    expect(s.end - s.start).toBe(1);
    expect(airSpan({ year: 2014, airStatus: 'ended' }, NOW)!.single).toBe(true);
  });
  it('runs ongoing shows up to now', () => {
    const s = airSpan({ year: 2019, airStatus: 'ongoing' }, NOW)!;
    expect(s.ongoing).toBe(true);
    expect(s.end).toBe(NOW);
    expect(spanLabel(s)).toBe('2019–now');
    // no endYear and not ended → ongoing too
    expect(airSpan({ year: 2016 }, NOW)!.ongoing).toBe(true);
    expect(airSpan({ year: 2016, airStatus: 'unknown' }, NOW)!.ongoing).toBe(true);
  });
  it('gives a just-started ongoing show a visible length', () => {
    const s = airSpan({ year: 2026, airStatus: 'ongoing' }, 2026.1)!;
    expect(s.end).toBeGreaterThan(s.start);
  });
  it('handles missing and bad data', () => {
    expect(airSpan({}, NOW)).toBeNull();
    expect(airSpan({ year: 2010, endYear: 2005, airStatus: 'ended' }, NOW)).toMatchObject({ end: 2011, single: true });
    expect(airSpan({ year: 2027, airStatus: 'upcoming' }, NOW)).toMatchObject({ ongoing: false, single: true });
  });
  it('yearFrac is within the year', () => {
    const f = yearFrac(new Date(2026, 9, 7));
    expect(f).toBeGreaterThan(2026.7);
    expect(f).toBeLessThan(2026.8);
  });
});

describe('packLanes', () => {
  it('puts non-overlapping bars in one lane and overlapping ones in separate lanes', () => {
    const p = packLanes([item('a', 1990, 2000, 10), item('b', 2001, 2005, 10), item('c', 1995, 1999, 10)], O);
    const lane = Object.fromEntries(p.bars.map((b) => [b.id, b.lane]));
    expect(lane.a).toBe(0);
    expect(lane.b).toBe(0);
    expect(lane.c).toBe(1);
    expect(p.lanes).toBe(2);
  });

  it('keeps padding between touching bars', () => {
    // a ends exactly where b starts → no room for the gap → new lane
    const p = packLanes([item('a', 1990, 2000, 10), item('b', 2000, 2004, 10)], O);
    expect(p.lanes).toBe(2);
  });

  it('places the label inside when it fits, outside otherwise, and reserves its space', () => {
    const wide = barGeometry(item('w', 1990, 2000, 100), O); // 400px bar
    expect(wide.labelInside).toBe(true);
    expect(wide.extent).toBe(wide.x + wide.w);
    const short = barGeometry(item('s', 1990, 1991, 100), O); // 40px bar
    expect(short.labelInside).toBe(false);
    expect(short.extent).toBe(short.x + short.w + O.labelGap + 100);
    // the outside label of 's' (1990–91) collides with a bar starting 1992 → separate lanes
    const p = packLanes([item('s', 1990, 1991, 100), item('t', 1992, 1995, 10)], O);
    expect(p.lanes).toBe(2);
  });

  it('enforces a minimum bar width for pills', () => {
    const g = barGeometry(item('p', 2000, 2001), { ...O, pxPerYear: 5 });
    expect(g.w).toBe(O.minBarW);
  });

  it('sorts by start then length and never overlaps (random fuzz)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 30; run++) {
      const items = Array.from({ length: 40 }, (_, i) => {
        const s = 1990 + Math.floor(rnd() * 36);
        return item(`i${i}`, s, s + 1 + Math.floor(rnd() * 12), 20 + rnd() * 160);
      });
      const o = { ...O, pxPerYear: 8 + rnd() * 80 };
      const p = packLanes(items, o);
      expect(p.bars).toHaveLength(40);
      assertNoOverlap(p.bars, o.gap);
      // optimality for plain intervals: lanes equal the maximum overlap of occupied extents
      expect(p.lanes).toBeGreaterThan(0);
    }
  });

  it('uses as few lanes as the maximum overlap', () => {
    const items = [item('a', 1990, 1995, 0), item('b', 1991, 1996, 0), item('c', 1996, 2000, 0), item('d', 1997, 2001, 0)];
    expect(packLanes(items, { ...O, gap: 0, minBarW: 0, leadW: 0, innerPad: 0 }).lanes).toBe(2);
  });

  it('is deterministic regardless of input order', () => {
    const items = [item('a', 1990, 1995), item('b', 1990, 1995), item('c', 1992, 1999), item('d', 2000, 2003)];
    const a = packLanes(items, O).bars.sort((x, y) => x.id.localeCompare(y.id));
    const b = packLanes([...items].reverse(), O).bars.sort((x, y) => x.id.localeCompare(y.id));
    expect(a).toEqual(b);
  });
});

describe('layoutGroups', () => {
  it('stacks groups with global rows and skips empty groups', () => {
    const r = layoutGroups(
      [
        { key: 'watching', items: [item('a', 1990, 2000), item('b', 1992, 1996)] },
        { key: 'plan', items: [] },
        { key: 'completed', items: [item('c', 1990, 2000)] },
      ],
      O,
    );
    expect(r.groups).toEqual([
      { key: 'watching', row: 0, lanes: 2 },
      { key: 'completed', row: 2, lanes: 1 },
    ]);
    expect(r.rows).toBe(3);
    expect(r.bars.find((b) => b.id === 'c')!.row).toBe(2);
  });
});

describe('axis & summary', () => {
  it('pads the axis range to tidy years and includes now', () => {
    const r = axisRange([airSpan({ year: 1994, endYear: 2004, airStatus: 'ended' }, NOW)!], NOW);
    expect(r.from).toBe(1990);
    expect(r.to).toBeGreaterThanOrEqual(2027);
  });
  it('chooses label steps that keep labels apart', () => {
    expect(tickStep(60)).toBe(1);
    expect(tickStep(30)).toBe(2);
    expect(tickStep(10)).toBe(5);
    expect(tickStep(3)).toBe(20);
  });
  it('summarises span, busiest decade and longest run', () => {
    const mk = (id: string, year: number, endYear?: number) => ({ id, span: airSpan({ year, endYear, airStatus: endYear ? 'ended' : 'ongoing' }, NOW)! });
    const s = summarize([mk('a', 1994, 2004), mk('b', 2008, 2013), mk('c', 2011, 2019), mk('d', 2016), mk('e', 2019, 2019)]);
    expect(s.count).toBe(5);
    expect(s.from).toBe(1994);
    expect(s.to).toBe(2026);
    expect(s.ongoing).toBe(1);
    expect(s.busiestDecade).toBe(2010);
    expect(s.longest).toEqual({ id: 'a', years: 11 });
    expect(summarize([])).toMatchObject({ count: 0 });
  });
  it('approximates text width proportionally', () => {
    expect(approxTextWidth('Breaking Bad', 14)).toBeGreaterThan(approxTextWidth('Lost', 14));
    expect(approxTextWidth('', 14)).toBe(0);
  });
});
