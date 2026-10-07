import type { EpisodeInfo, ShowDetail, ShowSummary } from '../types';
import { useSettings } from '../store/settings';
import { normalizeTitle, titleSimilarity } from '../lib/text';
import { createTmdb, type TmdbClient } from './tmdb';
import { tvmaze } from './tvmaze';
import { allCatalog, catalogDetail, enrichFromCatalog, findInCatalog, relatedInCatalog, searchCatalog, syntheticSeasons } from './catalog';

/**
 * One façade over all metadata sources.
 *
 *  • "tmdb" mode — a TMDB key is configured: TMDB for everything.
 *  • "open" mode — no key: built-in catalog + TVmaze (keyless) for posters,
 *    search beyond the catalog and real episode lists.
 *
 * Show ids carry their source ("tmdb:1399", "tvmaze:82", "cat:dark"), so a
 * library built in one mode keeps working in the other.
 */

export type ProviderMode = 'tmdb' | 'open';

let client: { sig: string; tmdb: TmdbClient } | undefined;

export function getTmdb(): TmdbClient | undefined {
  const { tmdbKey, region, tmdbValid } = useSettings.getState();
  if (!tmdbKey || tmdbValid === false) return undefined;
  const sig = `${tmdbKey}|${region}`;
  if (client?.sig !== sig) client = { sig, tmdb: createTmdb({ key: tmdbKey, region }) };
  return client.tmdb;
}

export function providerMode(): ProviderMode {
  return getTmdb() ? 'tmdb' : 'open';
}

export function parseId(id: string): { source: string; ext: string } {
  const i = id.indexOf(':');
  return { source: id.slice(0, i), ext: id.slice(i + 1) };
}

/** Stable "same show" key across sources: normalised title + year. */
export function showKey(s: Pick<ShowSummary, 'title' | 'year'>): string {
  return `${normalizeTitle(s.title)}|${s.year ?? ''}`;
}

export async function searchShows(query: string, year?: number): Promise<ShowSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const tmdb = getTmdb();
  if (tmdb) {
    const r = await tmdb.search(q, year);
    if (r.length || !year) return r;
    return tmdb.search(q);
  }
  const local = searchCatalog(q).filter((s) => !year || !s.year || Math.abs(s.year - year) <= 1);
  let remote: ShowSummary[] = [];
  try {
    remote = (await tvmaze.search(q)).filter((s) => !year || !s.year || Math.abs(s.year - year) <= 1).map(enrichFromCatalog);
  } catch {
    return local;
  }
  // Prefer TVmaze (real posters + episodes); drop catalog duplicates of TVmaze hits.
  const remoteKeys = new Set(remote.map((s) => normalizeTitle(s.title)));
  const extra = local.filter((s) => !remoteKeys.has(normalizeTitle(s.title)));
  return [...remote, ...extra];
}

/** Instant, offline search (catalog only) — used for type-ahead before the network answers. */
export function searchLocal(query: string): ShowSummary[] {
  return searchCatalog(query, 8);
}

export async function getDetail(id: string, hint?: ShowSummary): Promise<ShowDetail> {
  const { source, ext } = parseId(id);
  if (source === 'tmdb') {
    const tmdb = getTmdb();
    if (tmdb) return tmdb.detail(Number(ext));
    if (hint) return openDetailFor(hint, id);
    throw new Error('This show comes from TMDB — add your TMDB key in Settings to load it.');
  }
  if (source === 'tvmaze') return enrichFromCatalog(await tvmaze.detail(Number(ext)));
  if (source === 'cat') {
    const base = catalogDetail(ext);
    if (!base) throw new Error('Unknown catalog show');
    return upgradeWithTvmaze(base);
  }
  // custom entries: everything we know is in the snapshot
  if (hint) return customDetail(hint);
  throw new Error('Unknown show');
}

function customDetail(s: ShowSummary, sizes?: number[]): ShowDetail {
  return { ...s, seasons: syntheticSeasons(sizes ?? []), synthetic: true, related: relatedInCatalog(s) };
}

/** Best-effort: attach real posters/episodes from TVmaze to a catalog show (keeps the cat: id). */
async function upgradeWithTvmaze(base: ShowDetail): Promise<ShowDetail> {
  try {
    const hits = await tvmaze.search(base.title);
    const match = hits.find((h) => titleSimilarity(h.title, base.title) > 0.9 && (!h.year || !base.year || Math.abs(h.year - base.year) <= 1));
    if (!match?.externalIds?.tvmaze) return base;
    const d = await tvmaze.detail(match.externalIds.tvmaze);
    if (!d.seasons.length) return { ...base, poster: d.poster, backdrop: d.backdrop };
    return {
      ...base,
      poster: d.poster ?? base.poster,
      backdrop: d.backdrop ?? base.backdrop,
      seasons: d.seasons,
      seasonCount: d.seasonCount,
      episodeCount: d.episodeCount,
      castFull: d.castFull?.length ? d.castFull : base.castFull,
      nextEpisode: d.nextEpisode,
      lastEpisode: d.lastEpisode,
      homepage: d.homepage,
      airStatus: d.airStatus !== 'unknown' ? d.airStatus : base.airStatus,
      synthetic: false,
      externalIds: { ...base.externalIds, ...d.externalIds },
    };
  } catch {
    return base;
  }
}

/** A tmdb: id without a key → serve it from the catalog/TVmaze under the original id. */
async function openDetailFor(hint: ShowSummary, id: string): Promise<ShowDetail> {
  const cat = findInCatalog(hint);
  const base = cat ? catalogDetail(cat.slug)! : customDetail(hint);
  const up = await upgradeWithTvmaze({ ...base, ...hint, seasons: base.seasons, related: base.related });
  return { ...up, id, source: hint.source };
}

/** Episodes for one season (TMDB needs a request per season; others are already embedded). */
export async function getSeasonEpisodes(detail: ShowDetail, season: number): Promise<EpisodeInfo[]> {
  const s = detail.seasons.find((x) => x.number === season);
  if (s?.episodes?.length) return s.episodes;
  const { source, ext } = parseId(detail.id);
  const tmdb = getTmdb();
  if (source === 'tmdb' && tmdb) return tmdb.season(Number(ext), season);
  return Array.from({ length: s?.episodeCount ?? 0 }, (_, i) => ({ season, number: i + 1 }));
}

/** Has this episode aired? Undated episodes only count for shows that have ended. */
export function hasAired(e: { airDate?: string }, d: Pick<ShowDetail, 'airStatus' | 'synthetic'>): boolean {
  if (d.synthetic) return true;
  if (!e.airDate) return d.airStatus === 'ended';
  return e.airDate <= new Date().toISOString().slice(0, 10);
}

/**
 * Aired episode counts, indexed by season number − 1 (sizes[0] = season 1).
 * Gaps in numbering (missing seasons, year-numbered seasons) are zero-filled
 * so progress maths can always use `sizes[season - 1]`.
 */
export function airedSeasonSizes(d: ShowDetail): number[] {
  const max = d.seasons.reduce((m, s) => Math.max(m, s.number), 0);
  const out = new Array<number>(max).fill(0);
  for (const s of d.seasons) out[s.number - 1] = airedInSeason(d, s);
  return out;
}

function airedInSeason(d: ShowDetail, s: ShowDetail['seasons'][number]): number {
  const today = new Date().toISOString().slice(0, 10);
  const last = d.lastEpisode;
  if (s.episodes?.length && !d.synthetic) return s.episodes.filter((e) => hasAired(e, d)).length;
  if (last && d.airStatus !== 'ended') {
    if (s.number < last.season) return s.episodeCount;
    if (s.number === last.season) return Math.min(s.episodeCount, last.number);
    return s.airDate && s.airDate <= today ? s.episodeCount : 0;
  }
  return s.episodeCount;
}

export function catalogPool(): ShowSummary[] {
  return allCatalog();
}

export { tvmaze };
