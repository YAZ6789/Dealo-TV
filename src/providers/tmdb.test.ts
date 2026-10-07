import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTmdb, mapDetail, mapListItem, tmdbPopularity } from './tmdb';

/** Trimmed real-shape TMDB responses (field names exactly as the API returns them). */
const LIST_ITEM = {
  id: 95396,
  name: 'Severance',
  original_name: 'Severance',
  overview: 'Mark leads a team of office workers whose memories have been surgically divided.',
  poster_path: '/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg',
  backdrop_path: '/npD65vPa4vvn1ZHpp3o05A5vdKT.jpg',
  first_air_date: '2022-02-17',
  genre_ids: [18, 9648, 10765],
  origin_country: ['US'],
  original_language: 'en',
  popularity: 180.4,
  vote_average: 8.4,
  vote_count: 2900,
};

const DETAIL = {
  ...LIST_ITEM,
  genres: [
    { id: 18, name: 'Drama' },
    { id: 9648, name: 'Mystery' },
    { id: 10765, name: 'Sci-Fi & Fantasy' },
  ],
  tagline: 'Work. Life. Balance.',
  homepage: 'https://tv.apple.com/show/severance',
  status: 'Returning Series',
  last_air_date: '2025-03-21',
  number_of_seasons: 2,
  number_of_episodes: 19,
  episode_run_time: [],
  networks: [{ name: 'Apple TV+' }],
  created_by: [{ name: 'Dan Erickson' }],
  seasons: [
    { season_number: 0, name: 'Specials', episode_count: 3, air_date: null, poster_path: null },
    { season_number: 1, name: 'Season 1', episode_count: 9, air_date: '2022-02-17', poster_path: '/s1.jpg' },
    { season_number: 2, name: 'Season 2', episode_count: 10, air_date: '2025-01-16', poster_path: '/s2.jpg' },
  ],
  next_episode_to_air: null,
  last_episode_to_air: { season_number: 2, episode_number: 10, name: 'Cold Harbor', air_date: '2025-03-21', runtime: 76, overview: 'Finale.', still_path: '/still.jpg' },
  keywords: { results: [{ id: 1, name: 'workplace' }, { id: 2, name: 'memory loss' }, { id: 3, name: 'Memory Loss' }] },
  aggregate_credits: { cast: [{ name: 'Adam Scott', roles: [{ character: 'Mark Scout' }], profile_path: '/adam.jpg' }] },
  external_ids: { imdb_id: 'tt11280740', tvdb_id: 371980 },
  videos: {
    results: [
      { key: 'teaser1', site: 'YouTube', type: 'Teaser' },
      { key: 'trailer-unofficial', site: 'YouTube', type: 'Trailer', official: false },
      { key: 'trailer-official', site: 'YouTube', type: 'Trailer', official: true },
    ],
  },
  content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }, { iso_3166_1: 'GB', rating: '15' }] },
  'watch/providers': { results: { GB: { link: 'https://www.themoviedb.org/tv/95396/watch?locale=GB', flatrate: [{ provider_name: 'Apple TV Plus', logo_path: '/apple.jpg' }] } } },
  recommendations: { page: 1, total_pages: 1, results: [{ ...LIST_ITEM, id: 1, name: 'Silo' }] },
  similar: { page: 1, total_pages: 1, results: [{ ...LIST_ITEM, id: 2, name: 'Dark', original_name: 'Dark', original_language: 'de' }] },
};

describe('mapListItem', () => {
  it('maps a TMDB search/discover result', () => {
    const s = mapListItem(LIST_ITEM);
    expect(s).toMatchObject({
      id: 'tmdb:95396',
      source: 'tmdb',
      title: 'Severance',
      originalTitle: undefined,
      year: 2022,
      language: 'en',
      country: 'US',
      rating: 8.4,
      votes: 2900,
      externalIds: { tmdb: 95396 },
    });
    expect(s.poster).toBe('https://image.tmdb.org/t/p/w342/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg');
    expect(s.backdrop).toContain('/w1280/');
    expect(s.genres).toEqual(expect.arrayContaining(['drama', 'mystery']));
    expect(s.popularity).toBeGreaterThan(50);
  });

  it('copes with sparse items (no art, no votes, no date)', () => {
    const s = mapListItem({ id: 7, name: 'Obscure' });
    expect(s).toMatchObject({ id: 'tmdb:7', title: 'Obscure', year: undefined, poster: undefined, rating: undefined, genres: [] });
  });

  it('tags Japanese animation as anime', () => {
    expect(mapListItem({ id: 8, name: 'Frieren', genre_ids: [16], original_language: 'ja' }).genres).toContain('anime');
  });
});

describe('mapDetail', () => {
  const d = mapDetail(DETAIL, 'GB');

  it('maps status, seasons (skipping specials) and episodes', () => {
    expect(d.airStatus).toBe('ongoing');
    expect(d.endYear).toBeUndefined();
    expect(d.seasons.map((s) => [s.number, s.episodeCount])).toEqual([
      [1, 9],
      [2, 10],
    ]);
    expect(d.lastEpisode).toMatchObject({ season: 2, number: 10, name: 'Cold Harbor', airDate: '2025-03-21', runtime: 76 });
    expect(d.lastEpisode?.still).toContain('/w300/still.jpg');
    expect(d.nextEpisode).toBeUndefined();
    // No episode_run_time → falls back to the last episode's runtime.
    expect(d.runtime).toBe(76);
  });

  it('picks the official trailer, the regional rating and providers', () => {
    expect(d.trailerKey).toBe('trailer-official');
    expect(d.contentRating).toBe('15');
    expect(d.watchProviders?.stream).toEqual([{ name: 'Apple TV Plus', logo: 'https://image.tmdb.org/t/p/w92/apple.jpg' }]);
    expect(mapDetail(DETAIL, 'FR').contentRating).toBe('TV-MA'); // US fallback
    expect(mapDetail(DETAIL, 'FR').watchProviders).toBeUndefined();
  });

  it('maps people, ids, keywords and related shows', () => {
    expect(d.creators).toEqual(['Dan Erickson']);
    expect(d.castFull?.[0]).toMatchObject({ name: 'Adam Scott', character: 'Mark Scout' });
    expect(d.externalIds).toEqual({ tmdb: 95396, imdb: 'tt11280740', tvdb: 371980 });
    expect(d.networks).toEqual(['Apple TV+']);
    expect(new Set(d.keywords).size).toBe(d.keywords?.length); // de-duplicated
    expect(d.related?.[0]).toMatchObject({ id: 'tmdb:1', title: 'Silo' });
    expect(d.similar?.[0]).toMatchObject({ id: 'tmdb:2', title: 'Dark', language: 'de' });
  });

  it('sets endYear for ended shows', () => {
    const ended = mapDetail({ ...DETAIL, status: 'Ended', last_air_date: '2019-08-02' }, 'US');
    expect(ended.airStatus).toBe('ended');
    expect(ended.endYear).toBe(2019);
  });
});

describe('tmdbPopularity', () => {
  it('is monotonic and bounded', () => {
    expect(tmdbPopularity(0, 0)).toBe(0);
    expect(tmdbPopularity(10, 100)).toBeLessThan(tmdbPopularity(100, 5000));
    expect(tmdbPopularity(1e6, 1e7)).toBeLessThanOrEqual(100);
  });
});

describe('createTmdb auth & key check', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends a v3 key as api_key and a v4 token as a Bearer header', async () => {
    const fetchMock = vi.fn(async () => respond(200));
    vi.stubGlobal('fetch', fetchMock);
    await createTmdb({ key: '0123456789abcdef0123456789abcdef' }).check();
    const [url1, init1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toContain('api_key=0123456789abcdef0123456789abcdef');
    expect(init1.headers).toBeUndefined();

    await createTmdb({ key: 'eyJhbGciOiJIUzI1NiJ9.token' }).check();
    const [url2, init2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).not.toContain('api_key');
    expect((init2.headers as Record<string, string>).Authorization).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.token');
  });

  it('tells a rejected key apart from TMDB being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200)));
    expect(await createTmdb({ key: 'k' }).check()).toBe('ok');
    vi.stubGlobal('fetch', vi.fn(async () => respond(401, { status_message: 'Invalid API key' })));
    expect(await createTmdb({ key: 'k' }).check()).toBe('rejected');
    vi.stubGlobal('fetch', vi.fn(async () => respond(503)));
    expect(await createTmdb({ key: 'k' }).check()).toBe('unreachable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await createTmdb({ key: 'k' }).check()).toBe('unreachable');
  });
});
