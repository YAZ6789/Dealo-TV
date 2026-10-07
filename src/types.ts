/**
 * Core domain types shared by the store, metadata providers, the
 * recommendation engine, the importers and the UI.
 */

/** Canonical genre vocabulary. Every provider maps its own genres onto these. */
export const GENRES = [
  'action',
  'adventure',
  'animation',
  'anime',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'history',
  'horror',
  'kids',
  'legal',
  'medical',
  'music',
  'mystery',
  'news',
  'politics',
  'reality',
  'romance',
  'scifi',
  'soap',
  'sports',
  'supernatural',
  'talk',
  'thriller',
  'war',
  'western',
] as const;
export type GenreKey = (typeof GENRES)[number];

/**
 * Show ids are namespaced by the source they came from:
 *   tmdb:1399 · tvmaze:82 · cat:breaking-bad · custom:3f9a…
 */
export type ShowId = string;
export type Source = 'tmdb' | 'tvmaze' | 'catalog' | 'custom';

export type WatchStatus = 'watching' | 'plan' | 'completed' | 'on_hold' | 'dropped';

export const STATUS_ORDER: WatchStatus[] = ['watching', 'plan', 'completed', 'on_hold', 'dropped'];

export type AirStatus = 'ongoing' | 'ended' | 'upcoming' | 'unknown';

/** Normalised, provider-independent snapshot of a show. Small enough to persist. */
export interface ShowSummary {
  id: ShowId;
  source: Source;
  title: string;
  originalTitle?: string;
  year?: number;
  endYear?: number;
  overview?: string;
  /** Absolute image URLs (or undefined → procedural poster art is drawn). */
  poster?: string;
  backdrop?: string;
  genres: GenreKey[];
  /** Lower-case theme tags ("time travel", "heist", "dystopia" …). */
  keywords?: string[];
  networks?: string[];
  creators?: string[];
  cast?: string[];
  /** ISO 639-1 original language. */
  language?: string;
  /** ISO 3166-1 origin country. */
  country?: string;
  /** Community rating 0–10. */
  rating?: number;
  votes?: number;
  /** Rough 0–100 popularity score, comparable across providers. */
  popularity?: number;
  airStatus?: AirStatus;
  seasonCount?: number;
  episodeCount?: number;
  /** Average episode runtime in minutes. */
  runtime?: number;
  externalIds?: { imdb?: string; tvdb?: number; tmdb?: number; tvmaze?: number };
}

export interface EpisodeInfo {
  season: number;
  number: number;
  name?: string;
  airDate?: string;
  runtime?: number;
  overview?: string;
  still?: string;
}

export interface SeasonInfo {
  number: number;
  name?: string;
  episodeCount: number;
  airDate?: string;
  poster?: string;
  /** Filled lazily (TMDB needs one request per season). */
  episodes?: EpisodeInfo[];
}

export interface CastMember {
  name: string;
  character?: string;
  photo?: string;
}

export interface WatchProvider {
  name: string;
  logo?: string;
}

export interface ShowDetail extends ShowSummary {
  tagline?: string;
  homepage?: string;
  contentRating?: string;
  /** YouTube video key for the trailer. */
  trailerKey?: string;
  seasons: SeasonInfo[];
  nextEpisode?: EpisodeInfo;
  lastEpisode?: EpisodeInfo;
  castFull?: CastMember[];
  /** Provider-side "people who liked this also liked" list. */
  related?: ShowSummary[];
  /** Weaker, metadata-based "similar" list. */
  similar?: ShowSummary[];
  /** True when seasons/episodes were synthesised from counts (no titles/air dates). */
  synthetic?: boolean;
  watchProviders?: { stream: WatchProvider[]; link?: string };
}

/* ───────────────────────── Library ───────────────────────── */

export interface Position {
  season: number;
  episode: number;
}

export interface LibraryEntry {
  id: ShowId;
  show: ShowSummary;
  status: WatchStatus;
  /** Personal rating 1–10 (half steps allowed). */
  rating?: number;
  favorite?: boolean;
  notes?: string;
  /** season number → sorted list of watched episode numbers. */
  watched: Record<string, number[]>;
  /**
   * Last-known position when we have no per-episode data yet (e.g. imported
   * from a spreadsheet as "S2E5"). Resolved into `watched` once the episode
   * list is loaded.
   */
  position?: Position;
  /** Episode-count snapshot per season, so progress renders without a network call. */
  seasonSizes?: number[];
  rewatchCount?: number;
  addedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastWatchedAt?: string;
  origin?: 'manual' | 'import' | 'calibration' | 'recommendation';
}

export type BlockReason = 'not_interested' | 'seen_elsewhere' | 'disliked';

export interface BlockedEntry {
  id: ShowId;
  show: ShowSummary;
  at: string;
  reason: BlockReason;
}

export interface RecFeedback {
  id: ShowId;
  show: ShowSummary;
  /** +1 = "more like this", −1 = "less like this" (soft, not a block). */
  value: 1 | -1;
  at: string;
}

export type Affinity = 1 | -1;

export interface TasteProfile {
  genres: Partial<Record<GenreKey, Affinity>>;
  keywords: Record<string, Affinity>;
  preferences: {
    /** Preferred original languages; empty = no preference. */
    languages: string[];
    eraFrom?: number;
    eraTo?: number;
    /** Hard cap on the number of seasons (commitment level). */
    maxSeasons?: number;
    /** Minimum community rating 0–10. */
    minRating?: number;
    /** 0 = only safe bets … 1 = surprise me. */
    adventurousness: number;
    /** 0 = mainstream … 1 = hidden gems. */
    obscurity: number;
    preferEnded?: boolean;
  };
}

export type ActivityKind = 'episode' | 'unepisode' | 'status' | 'rating' | 'add';

export interface ActivityEvent {
  kind: ActivityKind;
  id: ShowId;
  at: string;
  season?: number;
  episode?: number;
  /** Runtime in minutes for episode events (for "hours watched"). */
  minutes?: number;
  status?: WatchStatus;
  rating?: number;
}

export interface ImportSource {
  id: string;
  kind: 'gsheet';
  label: string;
  url: string;
  /** Tab name or gid; empty = first tab. */
  tab?: string;
  /** Status to use when a row has none (e.g. a tab called "Watched"). */
  defaultStatus?: WatchStatus;
  mapping?: Partial<Record<ColumnRole, string>>;
  lastSyncAt?: string;
}

export type ColumnRole =
  | 'title'
  | 'status'
  | 'season'
  | 'episode'
  | 'progress'
  | 'rating'
  | 'notes'
  | 'year'
  | 'genre'
  | 'platform'
  | 'startedAt'
  | 'finishedAt'
  | 'favorite'
  | 'watchedFlag'
  | 'tmdbId'
  | 'imdbId';

/** The full persisted document. Versioned so it can be migrated and synced. */
export interface LibraryDoc {
  version: number;
  entries: Record<ShowId, LibraryEntry>;
  blocked: Record<ShowId, BlockedEntry>;
  feedback: Record<ShowId, RecFeedback>;
  taste: TasteProfile;
  activity: ActivityEvent[];
  importSources: ImportSource[];
  updatedAt: string;
}

/* ───────────────────────── Recommendations ───────────────────────── */

export type ReasonKind =
  | 'because' // because you liked X
  | 'genre'
  | 'keyword'
  | 'creator'
  | 'cast'
  | 'network'
  | 'acclaimed'
  | 'gem'
  | 'trending'
  | 'explore'
  | 'short';

export interface RecReason {
  kind: ReasonKind;
  label: string;
  /** For 'because': the seed show id. */
  ref?: ShowId;
  weight: number;
}

export interface Recommendation {
  show: ShowSummary;
  /** 0–100 match percentage shown in the UI. */
  match: number;
  score: number;
  reasons: RecReason[];
  /** Seeds (library ids) whose provider "related" lists contained this show. */
  seeds: ShowId[];
  exploratory?: boolean;
}
