import type { ShowSummary } from '../types';

/**
 * Sparse feature vectors for shows. Keys are namespaced:
 *   g:<genre> · k:<keyword> · c:<creator> · a:<actor> · n:<network>
 *   l:<language> · d:<decade> · len:<short|mid|long>
 */
export type Vec = Map<string, number>;

const W = {
  genre: 1.0,
  primaryGenre: 0.25,
  keyword: 1.1,
  creator: 1.6,
  actor: 0.45,
  network: 0.35,
  langForeign: 0.9,
  langEnglish: 0.15,
  decade: 0.3,
  length: 0.25,
};

export function lengthBucket(s: ShowSummary): 'short' | 'mid' | 'long' | undefined {
  const n = s.seasonCount;
  if (!n) return s.keywords?.includes('limited series') ? 'short' : undefined;
  return n <= 2 ? 'short' : n <= 5 ? 'mid' : 'long';
}

export function rawFeatures(s: ShowSummary): Vec {
  const v: Vec = new Map();
  const add = (k: string, w: number) => v.set(k, (v.get(k) ?? 0) + w);

  s.genres.forEach((g, i) => add(`g:${g}`, W.genre + (i === 0 ? W.primaryGenre : 0)));
  const kws = s.keywords ?? [];
  // Long, noisy keyword lists (TMDB) shouldn't drown out curated short ones.
  const kw = W.keyword / Math.sqrt(Math.max(1, kws.length / 6));
  for (const k of kws) add(`k:${k}`, kw);
  for (const c of (s.creators ?? []).slice(0, 3)) add(`c:${c.toLowerCase()}`, W.creator);
  for (const a of (s.cast ?? []).slice(0, 3)) add(`a:${a.toLowerCase()}`, W.actor);
  for (const n of (s.networks ?? []).slice(0, 2)) add(`n:${n.toLowerCase()}`, W.network);
  if (s.language) add(`l:${s.language}`, s.language === 'en' ? W.langEnglish : W.langForeign);
  if (s.year) add(`d:${Math.floor(s.year / 10) * 10}`, W.decade);
  const len = lengthBucket(s);
  if (len) add(`len:${len}`, W.length);
  return v;
}

/** Document frequencies over a corpus → IDF weights (rare shared traits matter more). */
export function buildIdf(corpus: Vec[]): (key: string) => number {
  const df = new Map<string, number>();
  for (const v of corpus) for (const k of v.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const n = corpus.length;
  return (key) => Math.log((n + 1) / ((df.get(key) ?? 0) + 1)) + 1;
}

export function weighted(v: Vec, idf: (k: string) => number): Vec {
  const out: Vec = new Map();
  for (const [k, w] of v) out.set(k, w * idf(k));
  return out;
}

export function norm(v: Vec): number {
  let s = 0;
  for (const w of v.values()) s += w * w;
  return Math.sqrt(s);
}

export function dot(a: Vec, b: Vec): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, w] of small) {
    const o = big.get(k);
    if (o) s += w * o;
  }
  return s;
}

export function cosine(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  return na && nb ? dot(a, b) / (na * nb) : 0;
}

/** a += b * scale */
export function addInto(a: Vec, b: Vec, scale = 1): void {
  for (const [k, w] of b) a.set(k, (a.get(k) ?? 0) + w * scale);
}

/** Per-feature contribution of b to cos(a, b), largest first (for explanations). */
export function topShared(a: Vec, b: Vec, n = 4): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, w] of b) {
    const o = a.get(k);
    if (o && o > 0) out.push([k, o * w]);
  }
  return out.sort((x, y) => y[1] - x[1]).slice(0, n);
}
