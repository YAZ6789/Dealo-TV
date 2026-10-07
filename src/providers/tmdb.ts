import type { AirStatus, CastMember, EpisodeInfo, GenreKey, SeasonInfo, ShowDetail, ShowSummary } from '../types';
import { TMDB_TV_GENRES, normalizeKeyword } from '../lib/genres';
import { cached, DAY, HOUR } from './cache';
import { clamp, fetchJson } from './http';

/**
 * The Movie Database (TMDB) v3 client. Accepts either a v3 API key or a v4
 * "API Read Access Token" (JWT, starts with "eyJ").
 * Attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB."
 */

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

export const img = (path: string | null | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' | 'w92' | 'w300') =>
  path ? `${IMG}${size}${path}` : undefined;

/* ── raw response shapes (only the fields we use) ── */
interface RawListItem {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  genre_ids?: number[];
  origin_country?: string[];
  original_language?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
}
interface RawPage {
  page: number;
  total_pages: number;
  results: RawListItem[];
}
interface RawEpisode {
  season_number: number;
  episode_number: number;
  name?: string;
  air_date?: string | null;
  runtime?: number | null;
  overview?: string;
  still_path?: string | null;
}
interface RawDetail extends Omit<RawListItem, 'genre_ids'> {
  genres?: { id: number; name: string }[];
  tagline?: string;
  homepage?: string;
  status?: string;
  last_air_date?: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  episode_run_time?: number[];
  networks?: { name: string }[];
  created_by?: { name: string }[];
  seasons?: { season_number: number; name?: string; episode_count: number; air_date?: string | null; poster_path?: string | null }[];
  next_episode_to_air?: RawEpisode | null;
  last_episode_to_air?: RawEpisode | null;
  keywords?: { results?: { id: number; name: string }[] };
  credits?: { cast?: { name: string; character?: string; profile_path?: string | null }[] };
  aggregate_credits?: { cast?: { name: string; roles?: { character: string }[]; profile_path?: string | null }[] };
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  videos?: { results?: { key: string; site: string; type: string; official?: boolean }[] };
  content_ratings?: { results?: { iso_3166_1: string; rating: string }[] };
  'watch/providers'?: { results?: Record<string, { link?: string; flatrate?: { provider_name: string; logo_path?: string }[] }> };
  recommendations?: RawPage;
  similar?: RawPage;
}

/** Combine TMDB's unbounded popularity and vote count into a rough 0–100 "how known is it" score. */
export function tmdbPopularity(pop = 0, votes = 0): number {
  const v = clamp(25 * Math.log10(1 + votes) - 25, 0, 100);
  const p = clamp(30 * Math.log10(1 + pop) - 10, 0, 100);
  return Math.round(0.6 * v + 0.4 * p);
}

function mapGenres(ids: number[], language?: string): GenreKey[] {
  const out = new Set<GenreKey>();
  for (const id of ids) for (const g of TMDB_TV_GENRES[id] ?? []) out.add(g);
  if (out.has('animation') && language === 'ja') out.add('anime');
  return [...out];
}

const yearOf = (d?: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);

export function mapListItem(r: RawListItem): ShowSummary {
  return {
    id: `tmdb:${r.id}`,
    source: 'tmdb',
    title: r.name,
    originalTitle: r.original_name && r.original_name !== r.name ? r.original_name : undefined,
    year: yearOf(r.first_air_date),
    overview: r.overview || undefined,
    poster: img(r.poster_path, 'w342'),
    backdrop: img(r.backdrop_path, 'w1280'),
    genres: mapGenres(r.genre_ids ?? [], r.original_language),
    language: r.original_language,
    country: r.origin_country?.[0],
    rating: r.vote_count ? r.vote_average : undefined,
    votes: r.vote_count,
    popularity: tmdbPopularity(r.popularity, r.vote_count),
    externalIds: { tmdb: r.id },
  };
}

function airStatus(s?: string): AirStatus {
  switch (s) {
    case 'Returning Series':
      return 'ongoing';
    case 'Ended':
    case 'Canceled':
      return 'ended';
    case 'In Production':
    case 'Planned':
    case 'Pilot':
      return 'upcoming';
    default:
      return 'unknown';
  }
}

const mapEpisode = (e: RawEpisode): EpisodeInfo => ({
  season: e.season_number,
  number: e.episode_number,
  name: e.name || undefined,
  airDate: e.air_date || undefined,
  runtime: e.runtime ?? undefined,
  overview: e.overview || undefined,
  still: img(e.still_path, 'w300'),
});

export function mapDetail(d: RawDetail, region: string): ShowDetail {
  const base = mapListItem({ ...d, genre_ids: (d.genres ?? []).map((g) => g.id) });
  const status = airStatus(d.status);
  const castRaw = d.aggregate_credits?.cast?.length ? d.aggregate_credits.cast : d.credits?.cast ?? [];
  const castFull: CastMember[] = castRaw.slice(0, 16).map((c) => ({
    name: c.name,
    character: 'roles' in c ? c.roles?.[0]?.character : (c as { character?: string }).character,
    photo: img(c.profile_path, 'w185'),
  }));
  const videos = d.videos?.results ?? [];
  const trailer =
    videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ??
    videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
    videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser');
  const ratings = d.content_ratings?.results ?? [];
  const cr = ratings.find((r) => r.iso_3166_1 === region) ?? ratings.find((r) => r.iso_3166_1 === 'US');
  const wp = d['watch/providers']?.results?.[region];
  const seasons: SeasonInfo[] = (d.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      number: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      airDate: s.air_date || undefined,
      poster: img(s.poster_path, 'w342'),
    }));
  const runtime = d.episode_run_time?.[0] ?? d.last_episode_to_air?.runtime ?? undefined;

  return {
    ...base,
    endYear: status === 'ended' ? yearOf(d.last_air_date) : undefined,
    airStatus: status,
    keywords: [...new Set((d.keywords?.results ?? []).map((k) => normalizeKeyword(k.name)))].slice(0, 30),
    networks: (d.networks ?? []).map((n) => n.name),
    creators: (d.created_by ?? []).map((c) => c.name),
    cast: castFull.slice(0, 6).map((c) => c.name),
    seasonCount: d.number_of_seasons,
    episodeCount: d.number_of_episodes,
    runtime: runtime ?? undefined,
    externalIds: {
      tmdb: d.id,
      imdb: d.external_ids?.imdb_id ?? undefined,
      tvdb: d.external_ids?.tvdb_id ?? undefined,
    },
    tagline: d.tagline || undefined,
    homepage: d.homepage || undefined,
    contentRating: cr?.rating || undefined,
    trailerKey: trailer?.key,
    seasons,
    nextEpisode: d.next_episode_to_air ? mapEpisode(d.next_episode_to_air) : undefined,
    lastEpisode: d.last_episode_to_air ? mapEpisode(d.last_episode_to_air) : undefined,
    castFull,
    related: (d.recommendations?.results ?? []).map(mapListItem),
    similar: (d.similar?.results ?? []).map(mapListItem),
    watchProviders: wp
      ? { stream: (wp.flatrate ?? []).map((p) => ({ name: p.provider_name, logo: img(p.logo_path, 'w92') })), link: wp.link }
      : undefined,
  };
}

export interface TmdbOptions {
  key: string;
  region?: string;
  language?: string;
}

export interface DiscoverQuery {
  genres?: number[];
  withoutGenres?: number[];
  keywords?: number[];
  language?: string;
  minVotes?: number;
  minRating?: number;
  sort?: 'popularity.desc' | 'vote_average.desc' | 'first_air_date.desc';
  page?: number;
  fromYear?: number;
}

export function createTmdb({ key, region = 'US', language = 'en-US' }: TmdbOptions) {
  const isToken = key.startsWith('eyJ');
  const tag = key.slice(-6);

  function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams();
    if (!isToken) qs.set('api_key', key);
    qs.set('language', language);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return fetchJson<T>(`${API}${path}?${qs}`, isToken ? { headers: { Authorization: `Bearer ${key}`, accept: 'application/json' } } : {});
  }
  const ck = (s: string) => `tmdb:${tag}:${language}:${s}`;

  return {
    kind: 'tmdb' as const,

    async validate(): Promise<boolean> {
      try {
        await get('/configuration');
        return true;
      } catch {
        return false;
      }
    },

    search(query: string, year?: number): Promise<ShowSummary[]> {
      return cached(ck(`search:${query.toLowerCase()}:${year ?? ''}`), 7 * DAY, async () => {
        const r = await get<RawPage>('/search/tv', { query, first_air_date_year: year, include_adult: 'false' });
        return r.results.map(mapListItem);
      });
    },

    detail(id: number): Promise<ShowDetail> {
      return cached(ck(`detail:${id}:${region}`), 2 * DAY, async () => {
        const d = await get<RawDetail>(`/tv/${id}`, {
          append_to_response: 'keywords,aggregate_credits,external_ids,videos,content_ratings,watch/providers,recommendations,similar',
        });
        return mapDetail(d, region);
      });
    },

    season(id: number, n: number): Promise<EpisodeInfo[]> {
      return cached(ck(`season:${id}:${n}`), DAY, async () => {
        const s = await get<{ episodes?: RawEpisode[] }>(`/tv/${id}/season/${n}`);
        return (s.episodes ?? []).map(mapEpisode);
      });
    },

    trending(page = 1): Promise<ShowSummary[]> {
      return cached(ck(`trending:${page}`), 6 * HOUR, async () => (await get<RawPage>('/trending/tv/week', { page })).results.map(mapListItem));
    },

    topRated(page = 1): Promise<ShowSummary[]> {
      return cached(ck(`top:${page}`), 3 * DAY, async () => (await get<RawPage>('/tv/top_rated', { page })).results.map(mapListItem));
    },

    popular(page = 1): Promise<ShowSummary[]> {
      return cached(ck(`popular:${page}`), DAY, async () => (await get<RawPage>('/tv/popular', { page })).results.map(mapListItem));
    },

    discover(q: DiscoverQuery): Promise<ShowSummary[]> {
      const params = {
        with_genres: q.genres?.length ? q.genres.join('|') : undefined,
        without_genres: q.withoutGenres?.length ? q.withoutGenres.join(',') : undefined,
        with_keywords: q.keywords?.length ? q.keywords.join('|') : undefined,
        with_original_language: q.language,
        'vote_count.gte': q.minVotes ?? 80,
        'vote_average.gte': q.minRating,
        'first_air_date.gte': q.fromYear ? `${q.fromYear}-01-01` : undefined,
        sort_by: q.sort ?? 'popularity.desc',
        page: q.page ?? 1,
        include_null_first_air_dates: 'false',
      };
      return cached(ck(`discover:${JSON.stringify(params)}`), DAY, async () => (await get<RawPage>('/discover/tv', params)).results.map(mapListItem));
    },

    searchKeyword(query: string): Promise<{ id: number; name: string }[]> {
      return cached(ck(`kw:${query.toLowerCase()}`), 30 * DAY, async () => (await get<{ results: { id: number; name: string }[] }>('/search/keyword', { query })).results);
    },

    async findByExternal(source: 'imdb_id' | 'tvdb_id', externalId: string | number): Promise<ShowSummary | undefined> {
      return cached(ck(`find:${source}:${externalId}`), 30 * DAY, async () => {
        const r = await get<{ tv_results?: RawListItem[] }>(`/find/${externalId}`, { external_source: source });
        const hit = r.tv_results?.[0];
        return hit ? mapListItem(hit) : undefined;
      });
    },
  };
}

export type TmdbClient = ReturnType<typeof createTmdb>;
