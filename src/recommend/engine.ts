import type {
  ActivityEvent,
  BlockedEntry,
  GenreKey,
  LibraryEntry,
  RecFeedback,
  RecReason,
  Recommendation,
  ShowId,
  ShowSummary,
  TasteProfile,
} from '../types';
import { GENRE_LABELS } from '../lib/genres';
import { normalizeTitle } from '../lib/text';
import { addInto, buildIdf, cosine, rawFeatures, topShared, weighted, type Vec } from './features';
import { collectSignals, type Seed } from './profile';

/**
 * Hybrid recommender.
 *
 *  1. Signals   — every library entry, rating, block and thumbs up/down becomes
 *                 a weighted positive or negative seed (see profile.ts).
 *  2. Profile   — seeds are embedded as IDF-weighted sparse vectors (genres,
 *                 themes, creators, cast, network, language, era, length) and
 *                 summed into a "like" vector P and a "dislike" vector N, plus
 *                 the explicit taste settings.
 *  3. Scoring   — content similarity to P, item-to-item co-occurrence from
 *                 provider "people also liked" lists, Bayesian-shrunk quality,
 *                 a popularity/obscurity preference, hard preference filters
 *                 and a penalty for resembling N.
 *  4. Re-rank   — Maximal Marginal Relevance for diversity, plus a few
 *                 exploration slots scaled by the user's "adventurousness".
 *  5. Explain   — the strongest seed ("Because you loved …") and the shared
 *                 traits that drove the match.
 */

export interface RelatedList {
  seed: ShowId;
  items: ShowSummary[];
  /** 1 = curated "recommendations", ~0.5 = metadata "similar". */
  strength: number;
}

export interface EngineInput {
  entries: Record<ShowId, LibraryEntry>;
  blocked: Record<ShowId, BlockedEntry>;
  feedback: Record<ShowId, RecFeedback>;
  taste: TasteProfile;
  activity: ActivityEvent[];
  candidates: ShowSummary[];
  related?: RelatedList[];
  now?: number;
  /** Weight of the co-occurrence signal (lower when "related" is itself content-based). */
  collabWeight?: number;
  /** Size of the diversified "picks" list. */
  limit?: number;
}

export interface TasteTrait {
  key: string;
  label: string;
  weight: number;
}

export interface EngineOutput {
  picks: Recommendation[];
  ranked: Recommendation[];
  seeds: Seed[];
  traits: TasteTrait[];
  dislikes: TasteTrait[];
  coldStart: boolean;
  /** Score any show against the same profile (detail pages, search results). */
  score: (show: ShowSummary) => Recommendation;
  /** Similarity of two candidate shows in profile space (0–1). */
  similarity: (a: ShowSummary, b: ShowSummary) => number;
}

/** Genres that are rarely what people mean by "a show to watch" unless they opted in. */
const NICHE: GenreKey[] = ['talk', 'news', 'soap', 'kids', 'reality'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function sameShowKey(s: Pick<ShowSummary, 'title' | 'year'>): string {
  return `${normalizeTitle(s.title)}|${s.year ?? ''}`;
}

/** Merge duplicates (same id) keeping the richest metadata. */
export function dedupeShows(list: ShowSummary[]): ShowSummary[] {
  const byId = new Map<ShowId, ShowSummary>();
  for (const s of list) {
    const prev = byId.get(s.id);
    if (!prev) byId.set(s.id, s);
    else
      byId.set(s.id, {
        ...prev,
        ...s,
        keywords: (s.keywords?.length ?? 0) >= (prev.keywords?.length ?? 0) ? s.keywords : prev.keywords,
        creators: s.creators?.length ? s.creators : prev.creators,
        cast: s.cast?.length ? s.cast : prev.cast,
        networks: s.networks?.length ? s.networks : prev.networks,
        genres: s.genres.length >= prev.genres.length ? s.genres : prev.genres,
      });
  }
  return [...byId.values()];
}

export function qualityOf(s: ShowSummary): number {
  if (s.rating == null || s.rating === 0) return 0.45;
  const C = 6.9;
  const bayes = s.votes != null ? (s.votes * s.rating + 120 * C) / (s.votes + 120) : 0.8 * s.rating + 0.2 * C;
  return clamp01((bayes - 6.0) / 2.8);
}

const langName = (() => {
  let dn: Intl.DisplayNames | undefined;
  try {
    dn = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    dn = undefined;
  }
  return (code: string) => dn?.of(code) ?? code.toUpperCase();
})();

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function recommend(input: EngineInput): EngineOutput {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? 24;
  const { taste } = input;
  const adv = clamp01(taste.preferences.adventurousness ?? 0.35);
  const obscurity = clamp01(taste.preferences.obscurity ?? 0.35);

  /* ── 1. signals ── */
  const signals = collectSignals({ ...input, now });
  const seeds = signals.positive;

  /* ── candidates: dedupe + exclude what the user already knows about ── */
  const knownIds = new Set<ShowId>([...Object.keys(input.entries), ...Object.keys(input.blocked)]);
  const knownKeys = new Set<string>();
  for (const e of Object.values(input.entries)) knownKeys.add(sameShowKey(e.show));
  for (const b of Object.values(input.blocked)) knownKeys.add(sameShowKey(b.show));
  // Titles without year match any year of the same title (imports often lack years).
  const knownTitles = new Set<string>();
  for (const e of Object.values(input.entries)) if (!e.show.year) knownTitles.add(normalizeTitle(e.show.title));

  const relatedItems = (input.related ?? []).flatMap((r) => r.items);
  const pool = dedupeShows([...input.candidates, ...relatedItems]).filter(
    (s) => !knownIds.has(s.id) && !knownKeys.has(sameShowKey(s)) && !knownTitles.has(normalizeTitle(s.title)) && s.title,
  );

  /* ── 2. feature space ── */
  const raw = new Map<ShowId, Vec>();
  const labelOf = new Map<string, string>();
  const featuresOf = (s: ShowSummary): Vec => {
    let v = raw.get(s.id);
    if (!v) {
      v = rawFeatures(s);
      raw.set(s.id, v);
      for (const c of s.creators ?? []) labelOf.set(`c:${c.toLowerCase()}`, c);
      for (const a of s.cast ?? []) labelOf.set(`a:${a.toLowerCase()}`, a);
      for (const n of s.networks ?? []) labelOf.set(`n:${n.toLowerCase()}`, n);
    }
    return v;
  };
  const corpus = [...pool, ...seeds.map((s) => s.show), ...signals.negative.map((s) => s.show)].map(featuresOf);
  const idf = buildIdf(corpus);
  const wcache = new Map<ShowId, Vec>();
  const vec = (s: ShowSummary): Vec => {
    let v = wcache.get(s.id);
    if (!v) {
      v = unit(weighted(featuresOf(s), idf));
      wcache.set(s.id, v);
    }
    return v;
  };

  const P: Vec = new Map();
  const N: Vec = new Map();
  let wSum = 0;
  for (const s of seeds) {
    addInto(P, vec(s.show), s.weight);
    wSum += s.weight;
  }
  if (wSum > 1) for (const [k, w] of P) P.set(k, w / wSum);
  let nSum = 0;
  for (const s of signals.negative) {
    addInto(N, vec(s.show), s.weight);
    nSum += s.weight;
  }
  if (nSum > 1) for (const [k, w] of N) N.set(k, w / nSum);

  // Explicit taste settings.
  const explicitScale = seeds.length ? 0.22 : 1;
  for (const [g, v] of Object.entries(taste.genres)) {
    const key = `g:${g}`;
    const target = v > 0 ? P : N;
    target.set(key, (target.get(key) ?? 0) + explicitScale * idf(key) * 0.5);
  }
  for (const [k, v] of Object.entries(taste.keywords)) {
    const key = `k:${k}`;
    const target = v > 0 ? P : N;
    target.set(key, (target.get(key) ?? 0) + explicitScale * idf(key) * 0.45);
  }

  const coldStart = P.size === 0;
  const optedIn = new Set<GenreKey>(
    NICHE.filter((g) => taste.genres[g] === 1 || seeds.some((s) => s.weight > 0.4 && s.show.genres.includes(g))),
  );

  /* ── co-occurrence (item-to-item) ── */
  const seedWeight = new Map(seeds.map((s) => [s.id, s.weight]));
  const collabRaw = new Map<ShowId, number>();
  const collabSeeds = new Map<ShowId, Map<ShowId, number>>();
  for (const list of input.related ?? []) {
    const sw = seedWeight.get(list.seed);
    if (!sw) continue;
    list.items.forEach((item, rank) => {
      const c = sw * list.strength / (1 + rank / 10);
      collabRaw.set(item.id, (collabRaw.get(item.id) ?? 0) + c);
      if (!collabSeeds.has(item.id)) collabSeeds.set(item.id, new Map());
      const m = collabSeeds.get(item.id)!;
      m.set(list.seed, (m.get(list.seed) ?? 0) + c);
    });
  }
  const collabW = coldStart ? 0 : input.collabWeight ?? 0.25;
  const contentW = coldStart ? 0 : 0.7 - collabW;

  /* ── 3. scoring ── */
  const prefs = taste.preferences;
  function prefAdjust(s: ShowSummary): { adj: number; hard: boolean } {
    let adj = 0;
    let hard = false;
    for (const g of s.genres) {
      if (taste.genres[g] === -1) {
        adj -= 0.35;
        hard = true;
      } else if (taste.genres[g] === 1) adj += 0.05;
      if (NICHE.includes(g) && !optedIn.has(g)) adj -= 0.3;
    }
    for (const k of s.keywords ?? []) {
      if (taste.keywords[k] === -1) adj -= 0.25;
      else if (taste.keywords[k] === 1) adj += 0.04;
    }
    if (prefs.languages.length && s.language && !prefs.languages.includes(s.language)) adj -= 0.3;
    if (prefs.eraFrom && s.year && s.year < prefs.eraFrom) adj -= 0.2;
    if (prefs.eraTo && s.year && s.year > prefs.eraTo) adj -= 0.2;
    if (prefs.maxSeasons && s.seasonCount && s.seasonCount > prefs.maxSeasons) adj -= 0.25;
    if (prefs.minRating && s.rating && s.rating < prefs.minRating) adj -= 0.3;
    if (prefs.preferEnded && s.airStatus === 'ongoing') adj -= 0.04;
    if (s.airStatus === 'upcoming') adj -= 0.15;
    return { adj, hard };
  }

  interface Scored {
    show: ShowSummary;
    score: number;
    content: number;
    collab: number;
    quality: number;
    neg: number;
    hard: boolean;
  }

  function scoreOne(s: ShowSummary): Scored {
    const v = vec(s);
    const content = coldStart ? 0 : clamp01(cosine(v, P) / 0.42);
    const neg = N.size ? clamp01(cosine(v, N) / 0.45) : 0;
    const collab = 1 - Math.exp(-(collabRaw.get(s.id) ?? 0) / 0.9);
    const quality = qualityOf(s);
    const p = clamp01((s.popularity ?? 30) / 100);
    const popTerm = (1 - obscurity) * p + obscurity * (1 - p) * (quality > 0.5 ? 1 : 0.4);
    const { adj, hard } = prefAdjust(s);
    const qualityW = coldStart ? 0.6 : 0.2;
    const popW = coldStart ? 0.3 : 0.07;
    const score = contentW * content + collabW * collab + qualityW * quality + popW * popTerm + adj - 0.35 * neg * (coldStart ? 0.6 : 1);
    return { show: s, score, content, collab, quality, neg, hard };
  }

  const matchPct = (x: Scored) => {
    const m = 100 / (1 + Math.exp(-(x.score - 0.3) * 9));
    return Math.round(Math.max(5, Math.min(99, m)));
  };

  /* ── 5. explanations ── */
  function explain(x: Scored): { reasons: RecReason[]; seedIds: ShowId[] } {
    const reasons: RecReason[] = [];
    const v = vec(x.show);
    // Strongest seed: similarity × seed weight, boosted when the provider also links them.
    let best: { seed: Seed; v: number } | undefined;
    const links = collabSeeds.get(x.show.id);
    for (const seed of seeds.slice(0, 60)) {
      const val = seed.weight * (cosine(v, vec(seed.show)) + (links?.get(seed.id) ? 0.6 : 0));
      if (!best || val > best.v) best = { seed, v: val };
    }
    if (best && best.v > 0.18) {
      reasons.push({ kind: 'because', label: `Because you ${best.seed.verb} ${best.seed.show.title}`, ref: best.seed.id, weight: best.v });
    }
    if (!coldStart) {
      for (const [key, w] of topShared(P, v, 5)) {
        const r = traitReason(key, labelOf);
        if (r && !reasons.some((x) => x.label === r.label)) reasons.push({ ...r, weight: w });
        if (reasons.length >= 4) break;
      }
    }
    const s = x.show;
    if ((s.rating ?? 0) >= 8.3 && (s.votes ?? 1000) >= 300) reasons.push({ kind: 'acclaimed', label: `Rated ${s.rating!.toFixed(1)}`, weight: 0.1 });
    if (x.quality >= 0.62 && (s.popularity ?? 50) < 35) reasons.push({ kind: 'gem', label: 'Hidden gem', weight: 0.1 });
    if ((s.seasonCount ?? 9) <= 1 || s.keywords?.includes('limited series')) reasons.push({ kind: 'short', label: 'One-season binge', weight: 0.05 });
    return { reasons, seedIds: links ? [...links.keys()] : [] };
  }

  function toRec(x: Scored, exploratory = false): Recommendation {
    const { reasons, seedIds } = explain(x);
    if (exploratory) reasons.unshift({ kind: 'explore', label: 'Outside your usual — highly rated', weight: 0.2 });
    return { show: x.show, match: matchPct(x), score: x.score, reasons, seeds: seedIds, exploratory };
  }

  const scored = pool.map(scoreOne).filter((x) => !x.hard || x.score > 0.55);
  scored.sort((a, b) => b.score - a.score);

  /* ── 4. diversity re-rank (MMR) + exploration ── */
  const lambda = 0.82 - 0.25 * adv;
  const head = scored.slice(0, Math.max(limit * 5, 80));
  const maxS = head[0]?.score ?? 1;
  const minS = head[head.length - 1]?.score ?? 0;
  const normS = (x: Scored) => (maxS > minS ? (x.score - minS) / (maxS - minS) : 1);
  const exploreSlots = coldStart ? 0 : Math.round(limit * (0.04 + 0.18 * adv));
  const mainSlots = limit - exploreSlots;
  const chosen: Scored[] = [];
  const remaining = [...head];
  while (chosen.length < mainSlots && remaining.length) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let maxSim = 0;
      for (const s of chosen) maxSim = Math.max(maxSim, cosine(vec(c.show), vec(s.show)));
      const val = lambda * normS(c) - (1 - lambda) * maxSim;
      if (val > bv) {
        bv = val;
        bi = i;
      }
    }
    chosen.push(remaining.splice(bi, 1)[0]);
  }
  const chosenIds = new Set(chosen.map((c) => c.show.id));
  const explore = scored
    .filter((x) => !chosenIds.has(x.show.id) && x.content >= 0.1 && x.content <= 0.55 && x.quality >= 0.6 && x.neg < 0.3 && !x.hard)
    .map((x) => ({ x, v: x.quality * 0.6 + (1 - x.content) * 0.2 + clamp01((x.show.popularity ?? 30) / 100) * 0.2 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, exploreSlots)
    .map((e) => e.x);

  const picks: Recommendation[] = chosen.map((c) => toRec(c));
  // Interleave exploration picks so they're visible but not dominant.
  explore.forEach((x, i) => picks.splice(Math.min(picks.length, 3 + i * 4), 0, toRec(x, true)));

  const ranked = scored.map((x) => toRec(x, explore.includes(x)));

  /* ── taste DNA for the UI ── */
  const traits = [...P.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, weight]) => ({ key, weight, label: traitReason(key, labelOf)?.label ?? key }))
    .filter((t) => !t.key.startsWith('d:') && !t.key.startsWith('len:') && t.key !== 'l:en')
    .slice(0, 24);
  const dislikes = [...N.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, weight]) => ({ key, weight, label: traitReason(key, labelOf)?.label ?? key }))
    .filter((t) => t.key.startsWith('g:') || t.key.startsWith('k:'))
    .slice(0, 10);

  return {
    picks,
    ranked,
    seeds,
    traits,
    dislikes,
    coldStart,
    score: (show) => toRec(scoreOne(show)),
    similarity: (a, b) => cosine(vec(a), vec(b)),
  };
}

function unit(v: Vec): Vec {
  let s = 0;
  for (const w of v.values()) s += w * w;
  const n = Math.sqrt(s) || 1;
  const out: Vec = new Map();
  for (const [k, w] of v) out.set(k, w / n);
  return out;
}

export function traitReason(key: string, labels: Map<string, string>): Omit<RecReason, 'weight'> | undefined {
  const [ns, ...rest] = key.split(':');
  const val = rest.join(':');
  switch (ns) {
    case 'g':
      return { kind: 'genre', label: GENRE_LABELS[val as GenreKey] ?? cap(val) };
    case 'k':
      return { kind: 'keyword', label: cap(val) };
    case 'c':
      return { kind: 'creator', label: `From ${labels.get(key) ?? cap(val)}` };
    case 'a':
      return { kind: 'cast', label: `With ${labels.get(key) ?? cap(val)}` };
    case 'n':
      return { kind: 'network', label: labels.get(key) ?? cap(val) };
    case 'l':
      return val === 'en' ? undefined : { kind: 'keyword', label: langName(val) };
    case 'd':
      return { kind: 'keyword', label: `${val}s` };
    case 'len':
      return val === 'short' ? { kind: 'short', label: 'Short & bingeable' } : undefined;
    default:
      return undefined;
  }
}
