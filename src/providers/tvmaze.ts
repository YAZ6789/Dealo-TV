import type { AirStatus, CastMember, EpisodeInfo, SeasonInfo, ShowDetail, ShowSummary } from '../types';
import { tvmazeGenres } from '../lib/genres';
import { cached, DAY } from './cache';
import { fetchJson, stripHtml } from './http';

/**
 * TVmaze — free, keyless, CORS-enabled TV database. Used when no TMDB key is
 * configured, for search, posters and real episode lists.
 * Data licensed CC BY-SA by TVmaze.com.
 */

const API = 'https://api.tvmaze.com';

interface RawImage {
  medium?: string;
  original?: string;
}
interface RawShow {
  id: number;
  name: string;
  type?: string;
  language?: string | null;
  genres?: string[];
  status?: string;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  officialSite?: string | null;
  rating?: { average?: number | null };
  weight?: number;
  network?: { name: string; country?: { code?: string } | null } | null;
  webChannel?: { name: string; country?: { code?: string } | null } | null;
  externals?: { imdb?: string | null; thetvdb?: number | null };
  image?: RawImage | null;
  summary?: string | null;
  _embedded?: {
    episodes?: RawEpisode[];
    cast?: { person: { name: string; image?: RawImage | null }; character?: { name: string } }[];
    crew?: { type: string; person: { name: string } }[];
    nextepisode?: RawEpisode;
    previousepisode?: RawEpisode;
    images?: RawImg[];
  };
}
interface RawEpisode {
  season: number;
  number: number | null;
  name?: string;
  type?: string;
  airdate?: string;
  runtime?: number | null;
  summary?: string | null;
  image?: RawImage | null;
}
interface RawImg {
  type: string;
  main?: boolean;
  resolutions?: { original?: { url: string }; medium?: { url: string } };
}

const LANGS: Record<string, string> = {
  english: 'en',
  japanese: 'ja',
  korean: 'ko',
  spanish: 'es',
  german: 'de',
  french: 'fr',
  italian: 'it',
  danish: 'da',
  swedish: 'sv',
  norwegian: 'no',
  turkish: 'tr',
  hindi: 'hi',
  portuguese: 'pt',
  chinese: 'zh',
  mandarin: 'zh',
  dutch: 'nl',
  polish: 'pl',
  russian: 'ru',
  hebrew: 'he',
  arabic: 'ar',
  icelandic: 'is',
  finnish: 'fi',
  thai: 'th',
};

function airStatus(s?: string): AirStatus {
  if (s === 'Running' || s === 'To Be Determined') return 'ongoing';
  if (s === 'Ended') return 'ended';
  if (s === 'In Development') return 'upcoming';
  return 'unknown';
}

const yearOf = (d?: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);
const https = (u?: string) => u?.replace(/^http:/, 'https:');

export function mapShow(r: RawShow): ShowSummary {
  const status = airStatus(r.status);
  const net = r.network ?? r.webChannel;
  return {
    id: `tvmaze:${r.id}`,
    source: 'tvmaze',
    title: r.name,
    year: yearOf(r.premiered),
    endYear: status === 'ended' ? yearOf(r.ended) : undefined,
    overview: stripHtml(r.summary),
    poster: https(r.image?.medium ?? r.image?.original),
    genres: tvmazeGenres(r.genres, r.type),
    networks: net ? [net.name] : undefined,
    language: r.language ? LANGS[r.language.toLowerCase()] ?? r.language.slice(0, 2).toLowerCase() : undefined,
    country: net?.country?.code ?? undefined,
    rating: r.rating?.average ?? undefined,
    popularity: r.weight,
    airStatus: status,
    runtime: r.averageRuntime ?? r.runtime ?? undefined,
    externalIds: { tvmaze: r.id, imdb: r.externals?.imdb ?? undefined, tvdb: r.externals?.thetvdb ?? undefined },
  };
}

const mapEpisode = (e: RawEpisode): EpisodeInfo => ({
  season: e.season,
  number: e.number ?? 0,
  name: e.name,
  airDate: e.airdate || undefined,
  runtime: e.runtime ?? undefined,
  overview: stripHtml(e.summary),
  still: https(e.image?.medium),
});

export function mapDetail(r: RawShow): ShowDetail {
  const base = mapShow(r);
  const eps = (r._embedded?.episodes ?? []).filter((e) => e.number != null && (e.type ?? 'regular') === 'regular').map(mapEpisode);
  const bySeason = new Map<number, EpisodeInfo[]>();
  for (const e of eps) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season)!.push(e);
  }
  const seasons: SeasonInfo[] = [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, list]) => ({ number, episodeCount: list.length, airDate: list[0]?.airDate, episodes: list }));
  const castFull: CastMember[] = (r._embedded?.cast ?? []).slice(0, 16).map((c) => ({
    name: c.person.name,
    character: c.character?.name,
    photo: https(c.person.image?.medium),
  }));
  const images = r._embedded?.images ?? [];
  const bg = images.find((i) => i.type === 'background' && i.main) ?? images.find((i) => i.type === 'background');
  const net = r.network ?? r.webChannel;
  return {
    ...base,
    poster: https(r.image?.original ?? r.image?.medium) ?? base.poster,
    backdrop: https(bg?.resolutions?.original?.url),
    homepage: r.officialSite ?? undefined,
    creators: (r._embedded?.crew ?? []).filter((c) => c.type === 'Creator').map((c) => c.person.name),
    cast: castFull.slice(0, 6).map((c) => c.name),
    castFull,
    seasons,
    seasonCount: seasons.length,
    episodeCount: eps.length,
    nextEpisode: r._embedded?.nextepisode ? mapEpisode(r._embedded.nextepisode) : undefined,
    lastEpisode: r._embedded?.previousepisode ? mapEpisode(r._embedded.previousepisode) : undefined,
    watchProviders: r.webChannel ? { stream: [{ name: r.webChannel.name }], link: r.officialSite ?? undefined } : net ? { stream: [{ name: net.name }] } : undefined,
  };
}

export const tvmaze = {
  kind: 'tvmaze' as const,

  search(query: string): Promise<ShowSummary[]> {
    return cached(`tvmaze:search:${query.toLowerCase()}`, 7 * DAY, async () => {
      const r = await fetchJson<{ score: number; show: RawShow }[]>(`${API}/search/shows?q=${encodeURIComponent(query)}`);
      return r.map((x) => mapShow(x.show));
    });
  },

  detail(id: number): Promise<ShowDetail> {
    return cached(`tvmaze:detail:${id}`, DAY, async () => {
      const [r, images] = await Promise.all([
        fetchJson<RawShow>(`${API}/shows/${id}?embed[]=episodes&embed[]=cast&embed[]=crew&embed[]=nextepisode&embed[]=previousepisode`),
        fetchJson<RawImg[]>(`${API}/shows/${id}/images`).catch(() => [] as RawImg[]),
      ]);
      return mapDetail({ ...r, _embedded: { ...r._embedded, images } });
    });
  },

  lookupImdb(imdb: string): Promise<ShowSummary | undefined> {
    return cached(`tvmaze:imdb:${imdb}`, 30 * DAY, async () => {
      try {
        return mapShow(await fetchJson<RawShow>(`${API}/lookup/shows?imdb=${encodeURIComponent(imdb)}`));
      } catch {
        return undefined;
      }
    });
  },
};
