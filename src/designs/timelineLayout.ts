/**
 * Pure layout maths for the Life Timeline design: how long each show was on
 * air, packing the bars into lanes without overlaps (labels included), and the
 * little narrative summary at the top. No React, no DOM — unit tested.
 */

export interface AirShow {
  year?: number;
  endYear?: number;
  airStatus?: string;
}

export interface AirSpan {
  /** First year on air (bar starts at Jan 1 of this year). */
  start: number;
  /** Exclusive end in fractional years (a 2008–2013 show ends at 2014). */
  end: number;
  /** Still airing: the bar runs up to "now" with an open end. */
  ongoing: boolean;
  /** Aired within a single year — drawn as a short pill. */
  single: boolean;
  /** Inclusive display years. */
  from: number;
  to: number;
}

/** Fractional year for a date, e.g. 1 Oct 2026 ≈ 2026.75. */
export function yearFrac(d: Date): number {
  const y = d.getFullYear();
  const start = Date.UTC(y, 0, 1);
  const next = Date.UTC(y + 1, 0, 1);
  return y + (Date.UTC(y, d.getMonth(), d.getDate()) - start) / (next - start);
}

/**
 * The years a show ran. Ongoing = airStatus 'ongoing', or no endYear and not
 * ended/upcoming. Ongoing shows run to `now`; returns null without a start year.
 */
export function airSpan(show: AirShow, now: number): AirSpan | null {
  const y = show.year;
  if (!y || !Number.isFinite(y)) return null;
  const nowYear = Math.floor(now);
  const ongoing =
    show.airStatus === 'ongoing' || (!show.endYear && show.airStatus !== 'ended' && show.airStatus !== 'upcoming' && y <= nowYear);
  if (ongoing) {
    const end = Math.max(now, y + 0.5);
    return { start: y, end, ongoing: true, single: false, from: y, to: nowYear };
  }
  const last = show.endYear && show.endYear >= y ? show.endYear : y;
  return { start: y, end: last + 1, ongoing: false, single: last === y, from: y, to: last };
}

export function spanLabel(s: AirSpan): string {
  if (s.ongoing) return `${s.from}–now`;
  if (s.single) return String(s.from);
  return `${s.from}–${s.to}`;
}

/* ───────────────────────── Lane packing ───────────────────────── */

export interface LayoutItem {
  id: string;
  start: number;
  end: number;
  /** Width in px of the label (icon + title + extras), measured by the caller. */
  labelW: number;
}

export interface LayoutOptions {
  /** Horizontal scale. */
  pxPerYear: number;
  /** Year drawn at x = padLeft. */
  origin: number;
  padLeft: number;
  /** Bars are never narrower than this (single-year pills at low zoom). */
  minBarW: number;
  /** Space reserved at the start of every bar (poster thumbnail + insets). */
  leadW: number;
  /** Inner right padding when the label sits inside the bar. */
  innerPad: number;
  /** Gap between a bar and an outside label. */
  labelGap: number;
  /** Minimum horizontal gap between two things in one lane. */
  gap: number;
}

export interface LaidBar {
  id: string;
  /** Lane within its group. */
  lane: number;
  x: number;
  w: number;
  labelInside: boolean;
  /** Right edge of everything the bar occupies (bar or outside label). */
  extent: number;
}

export interface Packed {
  bars: LaidBar[];
  lanes: number;
  /** Rightmost occupied pixel. */
  right: number;
}

export function barGeometry(it: LayoutItem, o: LayoutOptions) {
  const x = o.padLeft + (it.start - o.origin) * o.pxPerYear;
  const w = Math.max(o.minBarW, (it.end - it.start) * o.pxPerYear);
  const labelInside = w >= o.leadW + it.labelW + o.innerPad;
  const extent = labelInside ? x + w : x + w + o.labelGap + it.labelW;
  return { x, w, labelInside, extent };
}

/**
 * Greedy interval packing (first fit, items sorted by start then longest
 * first). Each item occupies its bar plus — when the title doesn't fit inside —
 * the label to its right, so nothing in a lane ever overlaps.
 * Sorted-by-start first fit is optimal for interval graphs: lanes = max overlap.
 */
export function packLanes(items: LayoutItem[], o: LayoutOptions): Packed {
  const sorted = items
    .map((it) => ({ it, g: barGeometry(it, o) }))
    .sort((a, b) => a.it.start - b.it.start || b.it.end - a.it.end || a.it.id.localeCompare(b.it.id));
  const laneEnds: number[] = [];
  const bars: LaidBar[] = [];
  let right = 0;
  for (const { it, g } of sorted) {
    let lane = laneEnds.findIndex((end) => end + o.gap <= g.x);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(g.extent);
    } else laneEnds[lane] = g.extent;
    bars.push({ id: it.id, lane, x: g.x, w: g.w, labelInside: g.labelInside, extent: g.extent });
    right = Math.max(right, g.extent);
  }
  return { bars, lanes: laneEnds.length, right };
}

export interface LayoutGroup {
  key: string;
  items: LayoutItem[];
}

export interface LaidGroup {
  key: string;
  /** First global row of this group. */
  row: number;
  lanes: number;
}

/** Packs each group separately and stacks them; bars get a global `row`. */
export function layoutGroups(groups: LayoutGroup[], o: LayoutOptions) {
  const out: (LaidBar & { row: number; group: string })[] = [];
  const laid: LaidGroup[] = [];
  let row = 0;
  let right = 0;
  for (const g of groups) {
    if (!g.items.length) continue;
    const p = packLanes(g.items, o);
    for (const b of p.bars) out.push({ ...b, row: row + b.lane, group: g.key });
    laid.push({ key: g.key, row, lanes: p.lanes });
    row += p.lanes;
    right = Math.max(right, p.right);
  }
  return { bars: out, groups: laid, rows: row, right };
}

/** Rough text width when no canvas is available (≈ 0.55em per glyph). */
export function approxTextWidth(text: string, fontPx: number): number {
  let w = 0;
  for (const ch of text) w += /[ il.,'|!:;]/.test(ch) ? 0.3 : /[MW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.64 : 0.54;
  return Math.ceil(w * fontPx);
}

/* ───────────────────────── Axis & summary ───────────────────────── */

export interface Era {
  from: number;
  /** Inclusive; undefined = still going. */
  to?: number;
  label: string;
}

/** Rough eras of television, drawn as subtle background bands. */
export const ERAS: Era[] = [
  { from: 1950, to: 1979, label: 'Network era' },
  { from: 1980, to: 1998, label: 'Must-see TV' },
  { from: 1999, to: 2012, label: 'Golden age of TV' },
  { from: 2013, to: 2018, label: 'Streaming boom' },
  { from: 2019, label: 'Streaming wars' },
];

/** Viewport-independent axis range: whole decades around the data, with a year of air. */
export function axisRange(spans: AirSpan[], now: number): { from: number; to: number } {
  if (!spans.length) {
    const y = Math.floor(now);
    return { from: Math.floor((y - 20) / 10) * 10, to: y + 2 };
  }
  const min = Math.min(...spans.map((s) => s.start));
  const max = Math.max(now, ...spans.map((s) => s.end));
  return { from: Math.floor((min - 1) / 5) * 5, to: Math.ceil(max + 1) };
}

/** Step in years between year labels so that labels are ≥ minPx apart. */
export function tickStep(pxPerYear: number, minPx = 44): number {
  for (const s of [1, 2, 5, 10, 20, 50]) if (s * pxPerYear >= minPx) return s;
  return 100;
}

export interface Summary {
  count: number;
  from?: number;
  to?: number;
  ongoing: number;
  /** Decade with the most shows on air, e.g. 2010. */
  busiestDecade?: number;
  busiestCount: number;
  longest?: { id: string; years: number };
}

/** Narrative numbers for the header: span, busiest decade, longest-running. */
export function summarize(items: { id: string; span: AirSpan }[]): Summary {
  if (!items.length) return { count: 0, ongoing: 0, busiestCount: 0 };
  const from = Math.min(...items.map((i) => i.span.from));
  const to = Math.max(...items.map((i) => i.span.to));
  const decades = new Map<number, number>();
  let longest: Summary['longest'];
  for (const { id, span } of items) {
    for (let d = Math.floor(span.from / 10) * 10; d <= span.to; d += 10) decades.set(d, (decades.get(d) ?? 0) + 1);
    const years = span.to - span.from + 1;
    if (!longest || years > longest.years) longest = { id, years };
  }
  let busiestDecade: number | undefined;
  let busiestCount = 0;
  for (const [d, n] of [...decades].sort((a, b) => a[0] - b[0])) {
    if (n >= busiestCount) {
      busiestDecade = d;
      busiestCount = n;
    }
  }
  return { count: items.length, from, to, ongoing: items.filter((i) => i.span.ongoing).length, busiestDecade, busiestCount, longest };
}
