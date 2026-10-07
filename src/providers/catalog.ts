import type { EpisodeInfo, SeasonInfo, ShowDetail, ShowSummary } from '../types';
import { CATALOG, type CatalogShow } from '../data/catalog';
import { normalizeTitle, titleSimilarity } from '../lib/text';

/**
 * Built-in offline catalog. Always available — no network, no key. It powers
 * search/recommendations without TMDB and enriches TVmaze results with theme
 * tags (TVmaze has no keywords).
 */

export function catalogSummary(c: CatalogShow): ShowSummary {
  return {
    id: `cat:${c.slug}`,
    source: 'catalog',
    title: c.title,
    originalTitle: c.originalTitle,
    year: c.year,
    endYear: c.endYear,
    overview: c.overview,
    genres: [...c.genres],
    keywords: [...c.tags],
    networks: [c.network],
    creators: c.creators,
    cast: c.cast,
    language: c.language,
    country: c.country,
    rating: c.rating,
    votes: c.votes,
    popularity: c.popularity,
    airStatus: c.airStatus,
    seasonCount: c.seasons.length,
    episodeCount: c.seasons.reduce((a, b) => a + b, 0),
    runtime: c.runtime,
  };
}

let summaries: ShowSummary[] | undefined;
let bySlug: Map<string, CatalogShow> | undefined;
let byTitle: Map<string, CatalogShow[]> | undefined;

function index() {
  if (!summaries) {
    summaries = CATALOG.map(catalogSummary);
    bySlug = new Map(CATALOG.map((c) => [c.slug, c]));
    byTitle = new Map();
    for (const c of CATALOG) {
      for (const t of [c.title, c.originalTitle].filter(Boolean) as string[]) {
        const k = normalizeTitle(t);
        byTitle.set(k, [...(byTitle.get(k) ?? []), c]);
      }
    }
  }
  return { summaries, bySlug: bySlug!, byTitle: byTitle! };
}

export function allCatalog(): ShowSummary[] {
  return index().summaries;
}

export function getCatalogShow(slug: string): CatalogShow | undefined {
  return index().bySlug.get(slug);
}

/** Find the catalog entry that is the same show as `s` (by title + year). */
export function findInCatalog(s: Pick<ShowSummary, 'title' | 'originalTitle' | 'year'>): CatalogShow | undefined {
  const { byTitle } = index();
  for (const t of [s.title, s.originalTitle].filter(Boolean) as string[]) {
    const hits = byTitle.get(normalizeTitle(t));
    if (!hits) continue;
    const best = hits.find((c) => !s.year || Math.abs(c.year - s.year) <= 1);
    if (best) return best;
  }
  return undefined;
}

export function searchCatalog(query: string, limit = 20): ShowSummary[] {
  const q = normalizeTitle(query);
  if (!q) return [];
  const scored: { s: ShowSummary; score: number }[] = [];
  for (const s of index().summaries) {
    const t = normalizeTitle(s.title);
    let score = titleSimilarity(query, s.title);
    if (s.originalTitle) score = Math.max(score, titleSimilarity(query, s.originalTitle));
    if (t.startsWith(q)) score = Math.max(score, 0.9);
    else if (t.includes(q)) score = Math.max(score, 0.75);
    if (score >= 0.45) scored.push({ s, score: score + (s.popularity ?? 0) / 2000 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Copy catalog knowledge (tags, creators, ratings…) onto a thinner summary. */
export function enrichFromCatalog<T extends ShowSummary>(s: T): T {
  const c = findInCatalog(s);
  if (!c) return s;
  return {
    ...s,
    keywords: s.keywords?.length ? s.keywords : [...c.tags],
    genres: [...new Set([...s.genres, ...c.genres])],
    creators: s.creators?.length ? s.creators : c.creators,
    cast: s.cast?.length ? s.cast : c.cast,
    rating: s.rating ?? c.rating,
    votes: s.votes ?? c.votes,
    popularity: Math.max(s.popularity ?? 0, c.popularity),
    language: s.language ?? c.language,
    country: s.country ?? c.country,
  };
}

function overlap(a: ShowSummary, b: ShowSummary): number {
  const ga = new Set(a.genres);
  const ka = new Set(a.keywords ?? []);
  let s = 0;
  for (const g of b.genres) if (ga.has(g)) s += 1;
  for (const k of b.keywords ?? []) if (ka.has(k)) s += 1.6;
  if (a.language && a.language === b.language && a.language !== 'en') s += 1;
  if (a.creators?.some((c) => b.creators?.includes(c))) s += 3;
  return s / Math.sqrt((a.genres.length + (a.keywords?.length ?? 0)) * (b.genres.length + (b.keywords?.length ?? 0)) || 1);
}

/** Content-based "more like this" inside the catalog. */
export function relatedInCatalog(s: ShowSummary, n = 14): ShowSummary[] {
  return index()
    .summaries.filter((o) => o.id !== s.id && normalizeTitle(o.title) !== normalizeTitle(s.title))
    .map((o) => ({ o, v: overlap(s, o) + (o.rating ?? 6) / 40 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.o);
}

export function syntheticSeasons(sizes: number[]): SeasonInfo[] {
  return sizes.map((count, i) => ({
    number: i + 1,
    episodeCount: count,
    episodes: Array.from({ length: count }, (_, j): EpisodeInfo => ({ season: i + 1, number: j + 1 })),
  }));
}

export function catalogDetail(slug: string): ShowDetail | undefined {
  const c = getCatalogShow(slug);
  if (!c) return undefined;
  const s = catalogSummary(c);
  return {
    ...s,
    seasons: syntheticSeasons(c.seasons),
    castFull: c.cast.map((name) => ({ name })),
    related: relatedInCatalog(s),
    synthetic: true,
    watchProviders: { stream: [{ name: c.network }] },
  };
}
