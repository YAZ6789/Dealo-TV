/**
 * Dealo Wrapped — "your year in TV". Pure computation over the library doc:
 * no React, no DOM, so it is unit-tested in isolation (wrapped.test.ts).
 *
 * Two data regimes:
 *  - `activity`  — the year has per-episode history (ticked episodes with timestamps).
 *  - `completed` — no episode history that year (e.g. an imported spreadsheet that only
 *                  knows finish dates): every number is estimated from the shows whose
 *                  `completedAt` falls in the year.
 */
import type { ActivityEvent, GenreKey, LibraryDoc, LibraryEntry, ShowId } from '../types';
import { progressOf } from '../lib/progress';

export type PersonaId = 'binger' | 'completionist' | 'explorer' | 'critic' | 'night-owl' | 'loyalist' | 'sampler' | 'fresh';

export interface Persona {
  id: PersonaId;
  name: string;
  line: string;
}

export interface WrappedShow {
  entry: LibraryEntry;
  episodes: number;
  minutes: number;
}

export interface WrappedDayShow {
  entry: LibraryEntry;
  day: string; // yyyy-mm-dd (local)
}

export interface WrappedData {
  year: number;
  source: 'activity' | 'completed' | 'empty';
  episodes: number;
  minutes: number;
  hours: number;
  /** Distinct shows with any watching in the year. */
  showCount: number;
  activeDays: number;
  started: LibraryEntry[];
  finished: LibraryEntry[];
  /** Top 5 by episodes watched in the year. */
  topShows: WrappedShow[];
  /** Episodes per genre (a show counts towards each of its genres); `share` of all episodes, 0–1. */
  topGenres: { genre: GenreKey; episodes: number; share: number }[];
  genreCount: number;
  /** Most episodes in one calendar day (all shows), with the show you watched most that day. */
  biggestDay?: { day: string; episodes: number; minutes: number; entry?: LibraryEntry; showCount: number };
  /** Longest run of consecutive days with ≥1 episode, inside the year. */
  longestStreak?: { days: number; from: string; to: string };
  /** Episodes per month, Jan..Dec. */
  months: number[];
  busiestMonth?: { month: number; episodes: number };
  /** Episodes per weekday, Sun..Sat. */
  weekdays: number[];
  favouriteWeekday?: { day: number; episodes: number };
  /** Episodes per local hour 0..23 (activity years only). */
  hours24: number[];
  /** Share (0–1) of episodes logged 22:00–03:59. */
  nightShare: number;
  /** Days with 5+ episodes. */
  bingeDays: number;
  topRatedFinished?: LibraryEntry;
  firstShow?: WrappedDayShow;
  lastShow?: WrappedDayShow;
  /** Distinct original languages among the year's shows (ISO 639-1). */
  languages: string[];
  /** Share (0–1) of the year's shows (with a known language) not originally in English. */
  nonEnglishShare: number;
  nonEnglishCount: number;
  /** Shows from the year you gave a rating. */
  ratedCount: number;
  persona: Persona;
}

/* ───────────── helpers ───────────── */

const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inYear = (iso: string | undefined, year: number) => !!iso && !Number.isNaN(Date.parse(iso)) && new Date(iso).getFullYear() === year;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

interface TimedEpisode {
  id: ShowId;
  at: Date;
  day: string;
  minutes: number;
}

/** Net watched episodes (a later un-tick cancels the tick) with their full timestamp. */
export function timedEpisodes(activity: ActivityEvent[], runtime: (id: ShowId) => number): TimedEpisode[] {
  const last = new Map<string, ActivityEvent>();
  for (const a of activity) {
    if (a.kind !== 'episode' && a.kind !== 'unepisode') continue;
    last.set(`${a.id}|${a.season}|${a.episode}`, a);
  }
  const out: TimedEpisode[] = [];
  for (const a of last.values()) {
    if (a.kind !== 'episode') continue;
    const at = new Date(a.at);
    if (Number.isNaN(at.getTime())) continue;
    out.push({ id: a.id, at, day: localDay(at), minutes: a.minutes ?? runtime(a.id) });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Episodes a finished show contributes when we only know it was completed. */
const estimatedEpisodes = (e: LibraryEntry) => Math.max(progressOf(e).watched, e.show.episodeCount ?? 0) || 1;

/** Years (newest first) that have any episode activity or start/finish date. */
export function wrappedYears(doc: Pick<LibraryDoc, 'entries' | 'activity'>): number[] {
  const ys = new Set<number>();
  for (const a of doc.activity) if (a.kind === 'episode') ys.add(new Date(a.at).getFullYear());
  for (const e of Object.values(doc.entries)) {
    for (const iso of [e.startedAt, e.completedAt]) if (iso && !Number.isNaN(Date.parse(iso))) ys.add(new Date(iso).getFullYear());
  }
  return [...ys].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
}

/**
 * The year Wrapped opens on: the current year, unless it has barely started for you
 * (fewer than 10 episodes and fewer than 2 finished shows) and last year has data.
 */
export function defaultWrappedYear(doc: Pick<LibraryDoc, 'entries' | 'activity'>, now = new Date()): number {
  const cur = now.getFullYear();
  const years = wrappedYears(doc);
  if (!years.includes(cur - 1)) return cur;
  const w = computeWrapped(doc, cur);
  return w.episodes >= 10 || w.finished.length >= 2 ? cur : cur - 1;
}

/* ───────────── persona ───────────── */

export const PERSONAS: Record<PersonaId, Persona> = {
  'night-owl': { id: 'night-owl', name: 'The Night Owl', line: 'Your best TV happens after 10pm. Sleep is a spoiler.' },
  binger: { id: 'binger', name: 'The Binger', line: '“Just one more” is your love language — you watch in marathons.' },
  completionist: { id: 'completionist', name: 'The Completionist', line: 'You start it, you finish it. Credits roll on your watch.' },
  critic: { id: 'critic', name: 'The Critic', line: 'Nothing goes unrated. Every show gets your verdict.' },
  explorer: { id: 'explorer', name: 'The Explorer', line: 'Genres, languages, continents — your watchlist has a passport.' },
  loyalist: { id: 'loyalist', name: 'The Loyalist', line: 'A few shows, all in. You go deep, not wide.' },
  sampler: { id: 'sampler', name: 'The Sampler', line: 'A pilot here, a season there — always tasting what’s next.' },
  fresh: { id: 'fresh', name: 'The Fresh Start', line: 'A quiet year on the couch — your story is still loading.' },
};

/**
 * Each rule scores how strongly the year matches it; ≥ 1 means the threshold is met.
 * The highest score wins; ties resolve in rule order.
 */
export function pickPersona(w: Omit<WrappedData, 'persona'>): Persona {
  if (!w.episodes && !w.finished.length) return PERSONAS.fresh;
  const shows = Math.max(1, w.showCount);
  const topShare = w.topShows[0] && w.episodes ? w.topShows[0].episodes / w.episodes : 0;
  const scores: [PersonaId, number][] = [
    ['night-owl', w.source === 'activity' && w.episodes >= 10 ? w.nightShare / 0.5 : 0],
    ['binger', w.source === 'activity' && w.activeDays ? Math.max((w.bingeDays / w.activeDays) / 0.3, (w.biggestDay?.episodes ?? 0) / 10) : 0],
    ['completionist', w.finished.length >= 3 ? w.finished.length / shows / 0.6 : 0],
    ['critic', w.ratedCount >= 5 ? w.ratedCount / shows / 0.85 : 0],
    ['explorer', Math.max(w.genreCount / 14, w.languages.length / 3, w.nonEnglishCount >= 2 ? w.nonEnglishShare / 0.4 : 0)],
    ['loyalist', w.episodes >= 30 ? Math.max(topShare / 0.45, shows <= 4 ? 1.05 : 0) : 0],
  ];
  let best: [PersonaId, number] = ['sampler', 0.999];
  for (const s of scores) if (s[1] > best[1]) best = s;
  return PERSONAS[best[0]];
}

/* ───────────── main ───────────── */

export function computeWrapped(doc: Pick<LibraryDoc, 'entries' | 'activity'>, year: number): WrappedData {
  const entries = doc.entries;
  const runtime = (id: ShowId) => entries[id]?.show.runtime ?? 42;
  const all = timedEpisodes(doc.activity, runtime);
  const eps = all.filter((e) => e.at.getFullYear() === year && entries[e.id]);

  // First episode ever per show (for "started" when startedAt is missing).
  const firstEver = new Map<ShowId, Date>();
  for (const e of all) if (!firstEver.has(e.id)) firstEver.set(e.id, e.at);

  const list = Object.values(entries);
  const finished = list
    .filter((e) => inYear(e.completedAt, year))
    .sort((a, b) => Date.parse(a.completedAt!) - Date.parse(b.completedAt!));
  const started = list
    .filter((e) => (e.startedAt ? inYear(e.startedAt, year) : firstEver.get(e.id)?.getFullYear() === year))
    .sort((a, b) => Date.parse(a.startedAt ?? firstEver.get(a.id)!.toISOString()) - Date.parse(b.startedAt ?? firstEver.get(b.id)!.toISOString()));

  const months = Array.from({ length: 12 }, () => 0);
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const hours24 = Array.from({ length: 24 }, () => 0);
  const perShow = new Map<ShowId, { episodes: number; minutes: number }>();
  let source: WrappedData['source'];
  let minutes = 0;
  let episodes = 0;
  let activeDays = 0;
  let biggestDay: WrappedData['biggestDay'];
  let longestStreak: WrappedData['longestStreak'];
  let bingeDays = 0;
  let nightShare = 0;
  let firstShow: WrappedDayShow | undefined;
  let lastShow: WrappedDayShow | undefined;

  if (eps.length) {
    source = 'activity';
    const perDay = new Map<string, { n: number; minutes: number; shows: Map<ShowId, number> }>();
    let night = 0;
    for (const e of eps) {
      episodes++;
      minutes += e.minutes;
      const s = perShow.get(e.id) ?? { episodes: 0, minutes: 0 };
      s.episodes++;
      s.minutes += e.minutes;
      perShow.set(e.id, s);
      months[e.at.getMonth()]++;
      weekdays[e.at.getDay()]++;
      const h = e.at.getHours();
      hours24[h]++;
      if (h >= 22 || h < 4) night++;
      const d = perDay.get(e.day) ?? { n: 0, minutes: 0, shows: new Map() };
      d.n++;
      d.minutes += e.minutes;
      d.shows.set(e.id, (d.shows.get(e.id) ?? 0) + 1);
      perDay.set(e.day, d);
    }
    nightShare = night / episodes;
    activeDays = perDay.size;
    for (const [day, d] of perDay) {
      if (d.n >= 5) bingeDays++;
      if (!biggestDay || d.n > biggestDay.episodes || (d.n === biggestDay.episodes && day < biggestDay.day)) {
        const topId = [...d.shows.entries()].sort((a, b) => b[1] - a[1])[0][0];
        biggestDay = { day, episodes: d.n, minutes: d.minutes, entry: entries[topId], showCount: d.shows.size };
      }
    }
    const days = [...perDay.keys()].sort();
    let runStart = days[0];
    let run = 1;
    longestStreak = { days: 1, from: days[0], to: days[0] };
    for (let i = 1; i < days.length; i++) {
      if (dayDiff(days[i - 1], days[i]) === 1) run++;
      else {
        run = 1;
        runStart = days[i];
      }
      if (run > longestStreak.days) longestStreak = { days: run, from: runStart, to: days[i] };
    }
    firstShow = { entry: entries[eps[0].id], day: eps[0].day };
    const lastEp = eps[eps.length - 1];
    lastShow = { entry: entries[lastEp.id], day: lastEp.day };
  } else if (finished.length) {
    source = 'completed';
    for (const e of finished) {
      const n = estimatedEpisodes(e);
      const m = n * (e.show.runtime ?? 42);
      perShow.set(e.id, { episodes: n, minutes: m });
      episodes += n;
      minutes += m;
      const at = new Date(e.completedAt!);
      months[at.getMonth()] += n;
    }
    firstShow = { entry: finished[0], day: localDay(new Date(finished[0].completedAt!)) };
    const lf = finished[finished.length - 1];
    lastShow = { entry: lf, day: localDay(new Date(lf.completedAt!)) };
  } else {
    source = 'empty';
  }

  const topShows: WrappedShow[] = [...perShow.entries()]
    .map(([id, v]) => ({ entry: entries[id], ...v }))
    .sort((a, b) => b.episodes - a.episodes || b.minutes - a.minutes || a.entry.show.title.localeCompare(b.entry.show.title))
    .slice(0, 5);

  const genreEps = new Map<GenreKey, number>();
  for (const [id, v] of perShow) for (const g of new Set(entries[id].show.genres)) genreEps.set(g, (genreEps.get(g) ?? 0) + v.episodes);
  const topGenres = [...genreEps.entries()]
    .map(([genre, n]) => ({ genre, episodes: n, share: episodes ? n / episodes : 0 }))
    .sort((a, b) => b.episodes - a.episodes || a.genre.localeCompare(b.genre))
    .slice(0, 5);

  const yearShows = [...perShow.keys()].map((id) => entries[id]);
  const langs = new Set<string>();
  let known = 0;
  let nonEnglishCount = 0;
  for (const e of yearShows) {
    const l = e.show.language?.toLowerCase();
    if (!l) continue;
    known++;
    langs.add(l);
    if (l !== 'en') nonEnglishCount++;
  }

  const ratedFinished = finished.filter((e) => e.rating != null);
  const topRatedFinished = ratedFinished.sort((a, b) => b.rating! - a.rating! || (perShow.get(b.id)?.episodes ?? 0) - (perShow.get(a.id)?.episodes ?? 0))[0];

  const busiest = months.reduce((bi, n, i) => (n > months[bi] ? i : bi), 0);
  const favDay = weekdays.reduce((bi, n, i) => (n > weekdays[bi] ? i : bi), 0);

  const base: Omit<WrappedData, 'persona'> = {
    year,
    source,
    episodes,
    minutes,
    hours: Math.round(minutes / 60),
    showCount: perShow.size,
    activeDays,
    started,
    finished,
    topShows,
    topGenres,
    genreCount: genreEps.size,
    biggestDay,
    longestStreak,
    months,
    busiestMonth: months[busiest] ? { month: busiest, episodes: months[busiest] } : undefined,
    weekdays,
    favouriteWeekday: weekdays[favDay] ? { day: favDay, episodes: weekdays[favDay] } : undefined,
    hours24,
    nightShare,
    bingeDays,
    topRatedFinished,
    firstShow,
    lastShow,
    languages: [...langs].sort(),
    nonEnglishShare: known ? nonEnglishCount / known : 0,
    nonEnglishCount,
    ratedCount: yearShows.filter((e) => e.rating != null).length,
  };
  return { ...base, persona: pickPersona(base) };
}

/* ───────────── share text ───────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m];

/** Plain-text summary for the clipboard. `genreLabel` maps a genre key to its display name. */
export function wrappedText(w: WrappedData, genreLabel: (g: GenreKey) => string): string {
  const lines = [`My ${w.year} in TV — Dealo Wrapped`, ''];
  if (w.source === 'empty') {
    lines.push('A quiet year on the couch. Next year is loading…');
    return lines.join('\n');
  }
  lines.push(`${w.persona.name}: ${w.persona.line}`, '');
  lines.push(`${w.source === 'completed' ? '≈ ' : ''}${w.hours.toLocaleString('en')} hours · ${w.episodes.toLocaleString('en')} episodes · ${w.showCount} shows`);
  if (w.finished.length || w.started.length) lines.push(`Started ${w.started.length} · Finished ${w.finished.length}`);
  if (w.topShows.length) {
    lines.push('', 'Top shows:');
    w.topShows.slice(0, 5).forEach((s, i) => lines.push(`${i + 1}. ${s.entry.show.title} (${s.episodes} ep)`));
  }
  if (w.topGenres[0]) lines.push('', `Top genre: ${genreLabel(w.topGenres[0].genre)}`);
  if (w.biggestDay) lines.push(`Biggest binge: ${w.biggestDay.episodes} episodes in one day`);
  if (w.longestStreak && w.longestStreak.days > 1) lines.push(`Longest streak: ${w.longestStreak.days} days`);
  if (w.busiestMonth) lines.push(`Busiest month: ${monthName(w.busiestMonth.month)}`);
  if (w.topRatedFinished) lines.push(`Best finish: ${w.topRatedFinished.show.title} (${w.topRatedFinished.rating}/10)`);
  return lines.join('\n');
}
