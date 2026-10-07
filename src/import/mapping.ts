/**
 * Column auto-detection for user spreadsheets plus the cell parsers it relies
 * on (status, progress, rating, boolean, date). Everything here is pure.
 */
import type { ColumnRole, Position, WatchStatus } from '../types';
import { parseGenreText } from '../lib/genres';
import { stripDiacritics } from '../lib/text';
import type { Table } from './table';

/* ───────────────────────── Roles ───────────────────────── */

export const COLUMN_ROLES: ColumnRole[] = [
  'title',
  'status',
  'season',
  'episode',
  'progress',
  'rating',
  'notes',
  'year',
  'genre',
  'platform',
  'startedAt',
  'finishedAt',
  'favorite',
  'watchedFlag',
  'tmdbId',
  'imdbId',
];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  title: 'Title',
  status: 'Status',
  season: 'Season',
  episode: 'Episode',
  progress: 'Progress (e.g. S2E5)',
  rating: 'Rating',
  notes: 'Notes',
  year: 'Year',
  genre: 'Genre',
  platform: 'Platform',
  startedAt: 'Date started',
  finishedAt: 'Date finished',
  favorite: 'Favorite',
  watchedFlag: 'Watched? (yes/no)',
  tmdbId: 'TMDB id',
  imdbId: 'IMDb id',
};

export type ColumnMapping = Partial<Record<ColumnRole, number>>;

/* ───────────────────────── Small helpers ───────────────────────── */

/** Lower-case, no diacritics, punctuation → spaces, single spaces. */
function normText(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/['’‘`´ʼ]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/* ───────────────────────── Status ───────────────────────── */

type StatusOrBlocked = WatchStatus | 'blocked';

const STATUS_PHRASES: Record<StatusOrBlocked, string[]> = {
  completed: [
    'watched', 'done', 'finished', 'completed', 'complete', 'seen', 'x', 'yes', 'fully watched',
    'all watched', 'watched all', 'finished it', 'seen it', 'watched it', 'visto', 'vista',
    'terminado', 'terminada', 'termine', 'vu', 'gesehen', 'fertig', 'concluido', 'concluida',
  ],
  watching: [
    'watching', 'currently watching', 'in progress', 'current', 'started', 'ongoing', 'on going',
    'caught up', 'airing', 'rewatching', 're watching', 'rewatch', 'watching now', 'now watching',
    'continuing', 'still watching', 'keep watching', 'viendo', 'en cours', 'assistindo', 'guardando',
  ],
  plan: [
    'want to watch', 'to watch', 'plan to watch', 'planning to watch', 'planned', 'plan',
    'watchlist', 'watch list', 'queue', 'queued', 'later', 'watch later', 'next', 'up next',
    'maybe', 'todo', 'to do', 'not started', 'not yet started', 'wishlist', 'backlog', 'to start',
    'ptw', 'will watch', 'pendiente', 'por ver', 'a voir', 'want', 'interested',
  ],
  on_hold: [
    'on hold', 'hold', 'paused', 'pause', 'break', 'on break', 'waiting', 'waiting for new season',
    'waiting for next season', 'waiting for season', 'stopped for now', 'hiatus', 'on pause',
    'in pausa', 'en pausa',
  ],
  dropped: [
    'dropped', 'quit', 'stopped', 'abandoned', 'gave up', 'given up', 'didnt finish', 'did not finish',
    'dnf', 'never finished', 'stopped watching', 'abandonada', 'abandonado', 'abandonne',
  ],
  blocked: [
    'not interested', 'never', 'no', 'hate', 'hated', 'skip', 'dont recommend', 'do not recommend',
    'nope', 'not for me', 'nah', 'pass', 'never watching', 'wont watch', 'will not watch', 'no interest',
    'blocked', 'block',
  ],
};

const STATUS_LOOKUP = new Map<string, StatusOrBlocked>();
for (const [status, phrases] of Object.entries(STATUS_PHRASES) as [StatusOrBlocked, string[]][]) {
  for (const p of phrases) STATUS_LOOKUP.set(p, status);
}
/** Words too short/generic to be matched as the first word of a longer phrase. */
const EXACT_ONLY = new Set(['x', 'no', 'yes', 'nah', 'next', 'current', 'break', 'pass', 'want', 'plan', 'hold', 'later', 'interested']);

const STATUS_EMOJI: [RegExp, StatusOrBlocked][] = [
  [/[✅✔✓☑🏁]/u, 'completed'],
  [/[🔴▶👀📺🟢]/u, 'watching'],
  [/[⏳⌛🕐📅🔜📌🟡]/u, 'plan'],
  [/[⏸🟠💤]/u, 'on_hold'],
  [/[🗑🛑🟥]/u, 'dropped'],
  [/[❌✖🚫⛔👎]/u, 'blocked'],
];

/**
 * Map a free-text status cell onto a {@link WatchStatus}, or 'blocked' for
 * "not interested"-style values. Case/punctuation/emoji tolerant; also matches
 * a status word at the start of a longer cell ("Dropped – boring", "🔴 Watching").
 */
export function normalizeStatus(v: string | undefined | null): StatusOrBlocked | undefined {
  if (v == null) return undefined;
  const raw = String(v).trim();
  if (!raw) return undefined;
  const t = normText(raw);
  if (t) {
    const exact = STATUS_LOOKUP.get(t);
    if (exact) return exact;
    const words = t.split(' ');
    for (let n = Math.min(words.length - 1, 5); n >= 1; n--) {
      const phrase = words.slice(0, n).join(' ');
      if (n === 1 && EXACT_ONLY.has(phrase)) continue;
      const hit = STATUS_LOOKUP.get(phrase);
      if (hit) return hit;
    }
  }
  for (const [re, status] of STATUS_EMOJI) if (re.test(raw)) return status;
  return undefined;
}

/* ───────────────────────── Progress ───────────────────────── */

const SEASON_WORD = '(?:season|szn|series|temporada|saison|staffel|s)';
const EP_WORD = '(?:episode|episodio|ep|eps|e)';

const RE_SXE = new RegExp(
  `(?:^|[^\\p{L}])${SEASON_WORD}\\s*\\.?\\s*(\\d{1,3})\\s*[,\\-–—:/|;]?\\s*${EP_WORD}\\s*\\.?\\s*(\\d{1,4})(?!\\d)`,
  'iu',
);
const RE_NXM = /(?:^|[^\p{L}\d])(\d{1,2})\s*x\s*(\d{1,3})(?![\d.])/iu;
const RE_SEASON_ONLY = new RegExp(`(?:^|[^\\p{L}])${SEASON_WORD}\\s*\\.?\\s*(\\d{1,3})(?![\\d.x])`, 'iu');
const RE_EP_ONLY = new RegExp(`(?:^|[^\\p{L}])${EP_WORD}\\s*\\.?\\s*(\\d{1,4})(?![\\d.])`, 'iu');
const RE_FRACTION = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;

/**
 * Parse a "where am I" cell.
 *  "S2E5", "s02e05", "S2 E5", "S2 Ep5", "2x05", "Season 2 Episode 5", "Season 2, Ep 5" → {2,5}
 *  "S3" / "Season 3" → {3,0} (season started, no episode known)
 *  "E5" / "Ep 5" / "Episode 5" → {1,5}
 *  "5/10" → {1,5} (episode 5 of 10)
 * Bare numbers and decimals like "2.5" are ambiguous → undefined.
 */
export function parseProgress(v: string | undefined | null): Position | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  let m = s.match(RE_SXE);
  if (m) return { season: +m[1], episode: +m[2] };
  m = s.match(RE_NXM);
  if (m) return { season: +m[1], episode: +m[2] };
  m = s.match(RE_SEASON_ONLY);
  if (m && +m[1] > 0) return { season: +m[1], episode: 0 };
  m = s.match(RE_EP_ONLY);
  if (m) return { season: 1, episode: +m[1] };
  m = s.match(RE_FRACTION);
  if (m && +m[1] <= +m[2] && +m[2] > 0) return { season: 1, episode: +m[1] };
  return undefined;
}

/** Integer from a season/episode cell: "2", "S2", "Season 2", "Ep. 5" → number. */
export function parseCount(v: string | undefined | null): number | undefined {
  if (v == null) return undefined;
  const m = String(v)
    .trim()
    .match(/^(?:season|szn|s|episode|ep|eps|e|#|no\.?)?\s*\.?\s*(\d{1,4})(?:\.0+)?$/i);
  return m ? +m[1] : undefined;
}

/* ───────────────────────── Rating ───────────────────────── */

const round2 = (n: number) => Math.round(n * 2) / 2;
const clampRating = (n: number) => round2(Math.min(10, Math.max(1, n)));

/**
 * Parse a personal rating into the app's 1–10 scale (half steps).
 * Accepts "8", "8.5", "8,5", "8/10", "4/5", "4 out of 5", "★★★★☆", "⭐⭐⭐",
 * "4.5 stars", "85%". Plain numbers use `scale` (default: ≤10 → /10, else /100).
 * Letter grades and 0 ("unrated") → undefined.
 */
export function parseRating(v: string | undefined | null, scale?: 5 | 10 | 100): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // Star glyphs.
  const full = (s.match(/[★⭐🌟]/gu) ?? []).length;
  const half = (s.match(/½|⯪/gu) ?? []).length;
  if (full + half > 0 && !/\d/.test(s)) return clampRating(((full + half * 0.5) / 5) * 10);

  const num = (x: string) => parseFloat(x.replace(',', '.'));

  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:\/|out of|of|von|sur|de)\s*(\d+(?:[.,]\d+)?)/i);
  if (m) {
    const a = num(m[1]);
    const b = num(m[2]);
    if (!(b > 0) || !(a > 0) || a > b) return undefined;
    return clampRating((a / b) * 10);
  }
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (m) {
    const p = num(m[1]);
    return p > 0 && p <= 100 ? clampRating(p / 10) : undefined;
  }
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:stars?|[★⭐])/i);
  if (m) {
    const a = num(m[1]);
    if (!(a > 0)) return undefined;
    return clampRating(a <= 5 ? (a / 5) * 10 : a);
  }
  m = s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (m) {
    const a = num(m[1]);
    if (!(a > 0)) return undefined;
    const sc = scale ?? (a <= 10 ? 10 : 100);
    if (a > sc) return undefined;
    return clampRating((a / sc) * 10);
  }
  return undefined;
}

/** Infer the scale of a column of plain-number ratings: max ≤ 5 → 5, ≤ 10 → 10, else 100. */
export function inferRatingScale(values: string[]): 5 | 10 | 100 {
  let max = 0;
  for (const v of values) {
    const m = String(v ?? '').trim().match(/^(\d+(?:[.,]\d+)?)$/);
    if (m) max = Math.max(max, parseFloat(m[1].replace(',', '.')));
  }
  if (max === 0) return 10;
  if (max <= 5) return 5;
  if (max <= 10) return 10;
  return 100;
}

/** Like {@link inferRatingScale} but honours header hints ("out of 5", "/10", "stars", "%"). */
export function detectRatingScale(header: string, values: string[]): 5 | 10 | 100 {
  const h = header.toLowerCase();
  if (/(?:out of|\/)\s*5\b|\b5\s*stars?\b|\bstars?\b|★/.test(h)) return 5;
  if (/(?:out of|\/)\s*10\b/.test(h)) return 10;
  if (/(?:out of|\/)\s*100\b|%|percent/.test(h)) return 100;
  return inferRatingScale(values);
}

/* ───────────────────────── Boolean ───────────────────────── */

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', 'watched', 'done', 'seen', 'checked', 'si', 'oui', 'ja', 'sim', 'ok', 'complete', 'completed', 'finished']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'unchecked', 'not yet', 'nope', 'non', 'nein', 'nao', 'not watched', 'unwatched']);

/** Checkbox / yes-no cell → boolean; unknown or empty → undefined. */
export function parseBool(v: string | undefined | null): boolean | undefined {
  if (v == null) return undefined;
  const raw = String(v).trim();
  if (!raw) return undefined;
  if (/^[✓✔✅☑❤♥💖⭐★👍]+️?$/u.test(raw)) return true;
  if (/^(?:[✗✘❌✖☐👎]️?|-|–)$/u.test(raw)) return false;
  const t = normText(raw);
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return undefined;
}

/* ───────────────────────── Dates ───────────────────────── */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12, fev: 2, mai: 5, juin: 6, juil: 7, aou: 8, okt: 10, dez: 12, mrz: 3, maerz: 3,
};

function monthFromName(name: string): number | undefined {
  const n = stripDiacritics(name).toLowerCase().replace(/\.$/, '');
  if (MONTHS[n]) return MONTHS[n];
  for (const len of [4, 3]) {
    const k = n.slice(0, len);
    if (n.length >= 3 && MONTHS[k]) return MONTHS[k];
  }
  return undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoIfValid(y: number, m: number, d: number): string | undefined {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return undefined;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const fullYear = (y: number) => (y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);

/**
 * Parse a date cell into ISO `yyyy-mm-dd`. Accepts ISO (with optional time),
 * yyyy/mm/dd, US m/d/yyyy (d/m/yyyy when the first part is > 12), d.m.yyyy,
 * d-m-yyyy, "Jan 5, 2024", "5 January 2024", "January 2024" (→ the 1st),
 * gviz "Date(2024,0,15)" and Excel serial numbers (20000–80000).
 */
export function parseDate(v: string | undefined | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/))) return isoIfValid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})(?:,[\d,\s]*)?\)$/))) return isoIfValid(+m[1], +m[2] + 1, +m[3]);
  if ((m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/))) return isoIfValid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+[\d:]+(?:\s*[ap]m)?)?$/i))) {
    const a = +m[1];
    const b = +m[2];
    const y = fullYear(+m[3]);
    return a > 12 ? isoIfValid(y, b, a) : isoIfValid(y, a, b);
  }
  if ((m = s.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{2}|\d{4})$/))) return isoIfValid(fullYear(+m[3]), +m[2], +m[1]);
  // "Jan 5, 2024" / "January 5th 2024"
  if ((m = s.match(/^([\p{L}]{3,}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/iu))) {
    const mo = monthFromName(m[1]);
    return mo ? isoIfValid(+m[3], mo, +m[2]) : undefined;
  }
  // "5 Jan 2024" / "5. Januar 2024" / "5 de enero de 2024"
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\.?\s+(?:de\s+)?([\p{L}]{3,}\.?),?\s+(?:de\s+)?(\d{4})$/iu))) {
    const mo = monthFromName(m[2]);
    return mo ? isoIfValid(+m[3], mo, +m[1]) : undefined;
  }
  // "January 2024" / "Jan 2024"
  if ((m = s.match(/^([\p{L}]{3,}\.?),?\s+(\d{4})$/iu))) {
    const mo = monthFromName(m[1]);
    return mo ? isoIfValid(+m[2], mo, 1) : undefined;
  }
  // Excel serial day number.
  if ((m = s.match(/^(\d{5})(?:\.\d+)?$/))) {
    const n = +m[1];
    if (n >= 20000 && n <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  return undefined;
}

/** A plausible release year in a cell ("2019", "2019–2022", "(2019)"). */
export function parseYear(v: string | undefined | null): number | undefined {
  if (v == null) return undefined;
  const m = String(v).match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  return m ? +m[1] : undefined;
}

/* ───────────────────────── Header synonyms ───────────────────────── */

interface RoleSpec {
  strong: string[];
  weak?: string[];
}

const SYNONYMS: Record<ColumnRole, RoleSpec> = {
  title: {
    strong: [
      'title', 'name', 'show', 'shows', 'series', 'tv show', 'tv shows', 'tv series', 'program', 'programme',
      'series name', 'show name', 'show title', 'series title', 'series show', 'tv', 'titulo', 'titre', 'nombre',
      'serie', 'nom', 'titel', 'sendung', 'nome', 'titolo',
    ],
  },
  status: {
    strong: ['status', 'watch status', 'watching status', 'state', 'estado', 'statut', 'stato', 'my status'],
    weak: ['list', 'category', 'stage', 'situation'],
  },
  season: {
    strong: ['season', 's', 'szn', 'season #', 'season no', 'season number', 'temporada', 'saison', 'staffel', 'stagione', 'current season', 'last season watched'],
    weak: ['seasons'],
  },
  episode: {
    strong: ['episode', 'ep', 'eps', 'episode #', 'ep #', 'episode no', 'episode number', 'episodio', 'folge', 'current episode #', 'last episode #'],
    weak: ['episodes'],
  },
  progress: {
    strong: [
      'progress', 'where i am', 'current', 'last watched', 'up to', 'at', 'last episode', 'current episode',
      'last seen', 'left off', 'where i left off', 'current ep', 'last ep', 'last ep watched',
      'last watched episode', 'progreso', 'progres', 'fortschritt', 'where am i', 'next episode',
    ],
  },
  rating: {
    strong: [
      'rating', 'score', 'stars', 'my rating', 'rate', 'out of 10', 'grade', 'my score', 'rated', 'my stars',
      'my grade', 'puntuacion', 'bewertung', 'voto', 'valoracion', 'calificacion', 'personal rating', 'imdb rating',
    ],
    weak: ['out of'],
  },
  notes: {
    strong: ['notes', 'note', 'comments', 'comment', 'thoughts', 'review', 'remarks', 'opinion', 'notas', 'comentarios', 'commentaires', 'notizen', 'my thoughts', 'my review'],
    weak: ['description', 'info', 'details'],
  },
  year: {
    strong: ['year', 'released', 'release year', 'aired', 'first aired', 'premiere', 'premiered', 'year released', 'ano', 'annee', 'jahr', 'anno', 'release'],
  },
  genre: {
    strong: ['genre', 'genres', 'genero', 'generos', 'genere'],
    weak: ['type', 'category', 'kind', 'tags', 'tag'],
  },
  platform: {
    strong: ['platform', 'service', 'network', 'streaming', 'streaming service', 'channel', 'app', 'where to watch', 'plataforma', 'plateforme', 'provider', 'streamer', 'on'],
    weak: ['where'],
  },
  startedAt: {
    strong: ['started', 'start date', 'date started', 'started on', 'start', 'began', 'started watching', 'date begun', 'start watching'],
  },
  finishedAt: {
    strong: ['finished', 'completed', 'date finished', 'end date', 'watched on', 'date', 'date watched', 'finish date', 'finished on', 'completed on', 'date completed', 'ended', 'end', 'finished watching', 'date seen', 'when watched'],
    weak: ['watched', 'when'],
  },
  favorite: {
    strong: ['favorite', 'favourite', 'fav', 'fave', 'loved', 'favorites', 'favourites', 'favs', 'favorito', 'favori', 'love'],
  },
  watchedFlag: {
    strong: ['watched', 'seen', 'done', 'finished', 'completed', 'complete', 'have watched', 'have seen', 'watched it', 'visto'],
  },
  tmdbId: { strong: ['tmdb', 'tmdb id', 'tmdbid', 'tmdb_id', 'themoviedb', 'tmdb link'] },
  imdbId: { strong: ['imdb', 'imdb id', 'imdbid', 'imdb_id', 'imdb link', 'imdb url'] },
};

const NORMALIZED_SYNONYMS: [ColumnRole, string, boolean][] = [];
for (const role of COLUMN_ROLES) {
  const spec = SYNONYMS[role];
  for (const s of spec.strong) NORMALIZED_SYNONYMS.push([role, normText(s.replace('#', ' number ')), true]);
  for (const s of spec.weak ?? []) NORMALIZED_SYNONYMS.push([role, normText(s), false]);
}

/**
 * How strongly a header cell names each role, 0–1.
 * Exact synonym → 1 (weak synonym 0.8); synonym contained as a phrase
 * ("My Score (out of 5)" ⊃ "my score") → ~0.55–0.85.
 */
export function headerRoleScores(header: string): Partial<Record<ColumnRole, number>> {
  const out: Partial<Record<ColumnRole, number>> = {};
  const put = (role: ColumnRole, s: number) => {
    if (s > (out[role] ?? 0)) out[role] = s;
  };
  const raw = String(header ?? '');
  if (/[❤♥💖💕⭐]/u.test(raw)) put('favorite', 0.9);
  if (/[✓✔✅☑]/u.test(raw)) put('watchedFlag', 0.9);
  const h = normText(raw.replace('#', ' number '));
  if (!h) return out;
  const padded = ` ${h} `;
  for (const [role, syn, strong] of NORMALIZED_SYNONYMS) {
    if (!syn) continue;
    if (h === syn) {
      put(role, strong ? 1 : 0.8);
    } else if ((syn.length >= 3 || syn.includes(' ')) && padded.includes(` ${syn} `)) {
      const ratio = syn.length / h.length;
      put(role, strong ? 0.55 + 0.3 * ratio : 0.45 + 0.2 * ratio);
    }
  }
  // A question mark makes "Watched?" a yes/no column rather than a date.
  if (/\?\s*$|\?\s*\(/.test(raw) && out.watchedFlag) put('watchedFlag', 1);
  return out;
}

/* ───────────────────────── Content sniffing ───────────────────────── */

const KNOWN_PLATFORMS =
  /\b(?:netflix|hbo|max|hulu|prime|amazon|disney|apple|peacock|paramount|bbc|itv|channel 4|crunchyroll|youtube|showtime|starz|fx|amc|cbs|nbc|abc|fox|cable|tv|mubi|britbox|acorn|shudder|funimation|viki|stan|crave|now|sky|canal|movistar|globoplay|zee5|hotstar|tubi|pluto|roku|mgm|cw|syfy|usa|tnt|tbs|showmax)\b/i;

export interface ColumnStats {
  /** Non-empty sample values. */
  n: number;
  distinct: number;
  progress: number;
  status: number;
  bool: number;
  rating: number;
  ratingSelfDescribing: number;
  date: number;
  year: number;
  imdb: number;
  int: number;
  seasonLike: number;
  episodeLike: number;
  genre: number;
  platform: number;
  hearts: number;
  numeric: number;
  avgLen: number;
  titleLikeness: number;
}

/** Ratios (0–1, over non-empty values) of how many sample cells parse as each kind. */
export function columnStats(values: string[]): ColumnStats {
  const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  const n = vals.length;
  const ratio = (fn: (v: string) => boolean) => (n ? vals.filter(fn).length / n : 0);
  const distinct = new Set(vals.map((v) => v.toLowerCase())).size;
  const avgLen = n ? vals.reduce((a, v) => a + v.length, 0) / n : 0;
  const isNum = (v: string) => /^-?\d+(?:[.,]\d+)?$/.test(v);
  const stats: ColumnStats = {
    n,
    distinct,
    progress: ratio((v) => parseProgress(v) !== undefined && !RE_FRACTION.test(v)),
    status: ratio((v) => normalizeStatus(v) !== undefined),
    bool: ratio((v) => parseBool(v) !== undefined),
    rating: ratio((v) => parseRating(v) !== undefined),
    ratingSelfDescribing: ratio((v) => !isNum(v) && parseRating(v) !== undefined),
    // Excel serials only count as dates when nothing else does (they look like plain numbers).
    date: ratio((v) => !/^\d{5}(?:\.\d+)?$/.test(v) && parseDate(v) !== undefined) || 0.6 * ratio((v) => parseDate(v) !== undefined),
    year: ratio((v) => /^(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2})?)?$/.test(v)),
    imdb: ratio((v) => /^tt\d{5,10}$/i.test(v) || /imdb\.com\/title\/tt\d+/i.test(v)),
    int: ratio((v) => /^\d+$/.test(v) || /themoviedb\.org\/tv\/\d+/i.test(v)),
    seasonLike: ratio((v) => /^(?:s|season|szn)?\s*\.?\s*\d{1,2}(?:\.0+)?$/i.test(v)),
    episodeLike: ratio((v) => /^(?:e|ep|eps|episode)?\s*\.?\s*\d{1,4}(?:\.0+)?$/i.test(v) || RE_FRACTION.test(v)),
    genre: ratio((v) => parseGenreText(v).length > 0),
    platform: ratio((v) => KNOWN_PLATFORMS.test(v)),
    hearts: ratio((v) => /^[❤♥💖💕⭐★]+️?$/u.test(v)),
    numeric: ratio(isNum),
    avgLen,
    titleLikeness: 0,
  };
  const alpha = ratio(
    (v) =>
      /\p{L}.*\p{L}/u.test(v) &&
      normalizeStatus(v) === undefined &&
      parseBool(v) === undefined &&
      parseDate(v) === undefined &&
      parseProgress(v) === undefined,
  );
  const distinctRatio = n ? distinct / n : 0;
  // Titles are short-ish; very long text is more likely notes.
  const lenScore = avgLen <= 40 ? Math.min(1, 0.6 + avgLen / 15) : Math.max(0.2, 1 - (avgLen - 40) / 50);
  stats.titleLikeness = alpha * (0.4 + 0.6 * distinctRatio) * (0.4 + 0.6 * lenScore);
  return stats;
}

interface RoleRule {
  /** Content plausibility 0–1. */
  content: (s: ColumnStats) => number;
  /** Minimum content plausibility for a header match to count (strong / weak synonym). */
  gate: number;
  weakGate?: number;
  /** Score when no header matches, purely from content. */
  contentOnly?: (s: ColumnStats) => number;
}

const RULES: Record<ColumnRole, RoleRule> = {
  title: { content: (s) => s.titleLikeness, gate: 0, contentOnly: (s) => 0.35 * s.titleLikeness },
  status: {
    content: (s) => s.status,
    gate: 0,
    weakGate: 0.5,
    contentOnly: (s) =>
      s.status >= 0.6 && s.distinct <= 12 ? (s.bool >= 0.8 ? 0.3 : 0.5 + 0.3 * s.status) : 0,
  },
  season: { content: (s) => s.seasonLike, gate: 0.5 },
  episode: { content: (s) => s.episodeLike, gate: 0.5 },
  progress: {
    content: (s) => s.progress,
    gate: 0.3,
    contentOnly: (s) => (s.progress >= 0.5 ? 0.55 + 0.35 * s.progress : 0),
  },
  rating: {
    content: (s) => s.rating,
    gate: 0.4,
    contentOnly: (s) => (s.ratingSelfDescribing >= 0.6 ? 0.6 : 0),
  },
  notes: { content: () => 1, gate: 0 },
  year: { content: (s) => Math.max(s.year, s.date), gate: 0.5, contentOnly: (s) => (s.year >= 0.8 ? 0.5 : 0) },
  genre: {
    content: (s) => s.genre,
    gate: 0.4,
    contentOnly: (s) => (s.genre >= 0.7 && s.avgLen < 30 && s.status < 0.3 ? 0.45 : 0),
  },
  platform: {
    content: (s) => Math.max(0, 1 - s.numeric - s.date),
    gate: 0.5,
    weakGate: 0.3,
    contentOnly: (s) => (s.platform >= 0.5 && s.avgLen < 30 ? 0.55 : 0),
  },
  startedAt: { content: (s) => s.date, gate: 0.5 },
  finishedAt: { content: (s) => s.date, gate: 0.5, contentOnly: (s) => (s.date >= 0.8 ? 0.4 : 0) },
  favorite: {
    content: (s) => Math.max(s.bool, s.hearts),
    gate: 0.5,
    contentOnly: (s) => (s.hearts >= 0.8 ? 0.45 : 0),
  },
  watchedFlag: {
    content: (s) => s.bool,
    gate: 0.6,
    contentOnly: (s) => (s.bool >= 0.8 && s.distinct <= 4 && s.hearts < 0.5 ? 0.45 : 0),
  },
  tmdbId: { content: (s) => s.int, gate: 0.8 },
  imdbId: { content: (s) => s.imdb, gate: 0.5, contentOnly: (s) => (s.imdb >= 0.8 ? 0.7 : 0) },
};

/**
 * Guess which column holds what. Combines header synonyms with content
 * sniffing of up to 50 sample rows. Each column gets at most one role and a
 * title column is always chosen when the table has any columns.
 * `confidence` (0–1) per role lets the UI highlight guesses worth reviewing.
 */
export function detectColumns(table: Table): {
  mapping: ColumnMapping;
  confidence: Partial<Record<ColumnRole, number>>;
} {
  const width = table.headers.length;
  const sample = table.rows.slice(0, 50);
  const stats: ColumnStats[] = [];
  for (let j = 0; j < width; j++) stats.push(columnStats(sample.map((r) => r[j] ?? '')));

  const candidates: { role: ColumnRole; col: number; score: number }[] = [];
  for (let j = 0; j < width; j++) {
    const hs = headerRoleScores(table.headers[j]);
    const st = stats[j];
    for (const role of COLUMN_ROLES) {
      const rule = RULES[role];
      const h = hs[role] ?? 0;
      const c = rule.content(st);
      let score = 0;
      if (h > 0) {
        const isWeak = rule.weakGate !== undefined && weakOnly(table.headers[j], role);
        const gate = isWeak ? (rule.weakGate ?? rule.gate) : rule.gate;
        // Empty columns can't prove their content; accept on header alone for ungated roles only.
        if (st.n === 0 ? rule.gate === 0 : c >= gate) score = h * (0.6 + 0.4 * c);
      }
      if (!score && rule.contentOnly && st.n > 0) score = rule.contentOnly(st);
      if (score > 0) candidates.push({ role, col: j, score: Math.min(1, score - j * 0.0001) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || COLUMN_ROLES.indexOf(a.role) - COLUMN_ROLES.indexOf(b.role));

  const mapping: ColumnMapping = {};
  const confidence: Partial<Record<ColumnRole, number>> = {};
  const used = new Set<number>();
  for (const c of candidates) {
    if (c.score < 0.3) continue;
    if (mapping[c.role] !== undefined || used.has(c.col)) continue;
    mapping[c.role] = c.col;
    confidence[c.role] = Math.round(Math.max(0, c.score) * 100) / 100;
    used.add(c.col);
  }

  if (mapping.title === undefined && width > 0) {
    const order = stats.map((s, j) => ({ j, like: s.titleLikeness * (1 - 0.03 * j) })).sort((a, b) => b.like - a.like);
    const free = order.find((o) => !used.has(o.j) && o.like > 0);
    const pick = free ?? order[0];
    if (!free) {
      for (const role of COLUMN_ROLES) {
        if (mapping[role] === pick.j) {
          delete mapping[role];
          delete confidence[role];
        }
      }
    }
    mapping.title = pick.j;
    confidence.title = Math.round(Math.min(0.7, 0.25 + 0.5 * stats[pick.j].titleLikeness) * 100) / 100;
  }
  return { mapping, confidence };
}

/** True when the header matches `role` only via a weak synonym. */
function weakOnly(header: string, role: ColumnRole): boolean {
  const h = normText(String(header ?? '').replace('#', ' number '));
  const padded = ` ${h} `;
  for (const [r, syn, strong] of NORMALIZED_SYNONYMS) {
    if (r !== role || !strong || !syn) continue;
    if (h === syn || ((syn.length >= 3 || syn.includes(' ')) && padded.includes(` ${syn} `))) return false;
  }
  return true;
}

/** Convert an index mapping to header names (for persisting in `ImportSource.mapping`). */
export function mappingToHeaders(table: Table, mapping: ColumnMapping): Partial<Record<ColumnRole, string>> {
  const out: Partial<Record<ColumnRole, string>> = {};
  for (const role of COLUMN_ROLES) {
    const j = mapping[role];
    if (j !== undefined && table.headers[j] !== undefined) out[role] = table.headers[j];
  }
  return out;
}

/**
 * Re-apply a saved header-name mapping to a (possibly re-ordered) table.
 * Roles whose header no longer exists are dropped; returns undefined for
 * every role when nothing matches so callers can fall back to detection.
 */
export function mappingFromHeaders(table: Table, saved: Partial<Record<ColumnRole, string>>): ColumnMapping {
  const out: ColumnMapping = {};
  const lower = table.headers.map((h) => h.trim().toLowerCase());
  for (const role of COLUMN_ROLES) {
    const name = saved[role];
    if (!name) continue;
    const j = lower.indexOf(name.trim().toLowerCase());
    if (j >= 0) out[role] = j;
  }
  return out;
}
