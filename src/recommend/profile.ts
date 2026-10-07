import type { ActivityEvent, BlockedEntry, LibraryEntry, RecFeedback, ShowId, ShowSummary } from '../types';
import { progressOf } from '../lib/progress';

/**
 * How much a library entry says about the user's taste, in roughly [-1.2, 1.6].
 * Positive = "more like this", negative = "less like this".
 *
 * Explicit signals dominate (rating, favourite); implicit ones fill the gaps:
 * status, how far into the show they are, binge velocity, rewatches, recency.
 */
export function entryAffinity(e: LibraryEntry, ctx: { now: number; bingeCounts?: Map<ShowId, number> }): number {
  let w: number;
  if (e.rating != null) {
    // 10 → +1.2 · 8 → +0.67 · 6 → +0.13 · 5.5 → 0 · 4 → −0.4 · 1 → −1.2
    w = ((e.rating - 5.5) / 4.5) * 1.2;
    if (e.status === 'dropped') w -= 0.35;
  } else {
    w = { completed: 0.6, watching: 0.55, plan: 0.22, on_hold: 0.12, dropped: -0.65 }[e.status];
  }

  if (e.status === 'watching' || e.status === 'on_hold') {
    const p = progressOf(e);
    if (p.total) w += 0.35 * (p.pct / 100); // deep into a show = clearly enjoying it
  }
  if (e.status === 'dropped') {
    const p = progressOf(e);
    if (p.pct >= 60) w += 0.3; // dropped late is weaker evidence of dislike
  }
  if (e.favorite) w += 0.5;
  if (e.rewatchCount) w += Math.min(0.4, 0.2 * e.rewatchCount);

  const binge = ctx.bingeCounts?.get(e.id) ?? 0;
  if (binge >= 6 && w > 0) w += Math.min(0.3, binge / 40);

  // Recency: taste drifts — last year's obsessions count a bit less.
  const ts = Date.parse(e.lastWatchedAt ?? e.completedAt ?? e.updatedAt ?? e.addedAt);
  if (!Number.isNaN(ts) && w > 0) {
    const ageDays = Math.max(0, (ctx.now - ts) / 86_400_000);
    w *= 0.65 + 0.35 * Math.exp(-ageDays / 540);
  }
  return w;
}

/** Episodes watched per show in the last `days` days. */
export function bingeCounts(activity: ActivityEvent[], now: number, days = 21): Map<ShowId, number> {
  const since = now - days * 86_400_000;
  const out = new Map<ShowId, number>();
  for (let i = activity.length - 1; i >= 0; i--) {
    const a = activity[i];
    const t = Date.parse(a.at);
    if (t < since) break;
    if (a.kind === 'episode') out.set(a.id, (out.get(a.id) ?? 0) + 1);
  }
  return out;
}

export interface Seed {
  id: ShowId;
  show: ShowSummary;
  weight: number;
  /** How to phrase "because you …" */
  verb: 'loved' | 'watched' | 'are watching' | 'want to watch' | 'liked' | 'asked for more like';
}

export function verbFor(e: LibraryEntry, w: number): Seed['verb'] {
  if (e.favorite || (e.rating ?? 0) >= 8.5 || w >= 1.1) return 'loved';
  if (e.status === 'watching') return 'are watching';
  if (e.status === 'plan') return 'want to watch';
  if ((e.rating ?? 0) >= 7) return 'liked';
  return 'watched';
}

export interface Signals {
  positive: Seed[];
  negative: Seed[];
}

/** Turn the whole library + feedback + blocks into weighted taste signals. */
export function collectSignals(input: {
  entries: Record<ShowId, LibraryEntry>;
  blocked: Record<ShowId, BlockedEntry>;
  feedback: Record<ShowId, RecFeedback>;
  activity: ActivityEvent[];
  now: number;
}): Signals {
  const bc = bingeCounts(input.activity, input.now);
  const positive: Seed[] = [];
  const negative: Seed[] = [];
  for (const e of Object.values(input.entries)) {
    const w = entryAffinity(e, { now: input.now, bingeCounts: bc });
    if (w > 0.02) positive.push({ id: e.id, show: e.show, weight: w, verb: verbFor(e, w) });
    else if (w < -0.02) negative.push({ id: e.id, show: e.show, weight: -w, verb: 'watched' });
  }
  for (const f of Object.values(input.feedback)) {
    if (input.entries[f.id]) continue;
    if (f.value > 0) positive.push({ id: f.id, show: f.show, weight: 0.5, verb: 'asked for more like' });
    else negative.push({ id: f.id, show: f.show, weight: 0.45, verb: 'watched' });
  }
  for (const b of Object.values(input.blocked)) {
    if (input.entries[b.id]) continue;
    const w = b.reason === 'disliked' ? 0.8 : b.reason === 'not_interested' ? 0.3 : 0;
    if (w) negative.push({ id: b.id, show: b.show, weight: w, verb: 'watched' });
  }
  positive.sort((a, b) => b.weight - a.weight);
  negative.sort((a, b) => b.weight - a.weight);
  return { positive, negative };
}
