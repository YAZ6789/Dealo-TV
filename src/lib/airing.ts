/**
 * Pure helpers for the Airing page: dates, labels, spoiler-safe episode names,
 * week grouping, notification bookkeeping and an iCalendar (.ics) generator.
 * No React, no storage — everything here is unit-tested.
 */

export interface EpisodeRef {
  season: number;
  number: number;
  name?: string;
  overview?: string;
}

const DAY = 86_400_000;

/** Local calendar date as yyyy-mm-dd. */
export function localIso(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const noon = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

/** yyyy-mm-dd ± n days (calendar arithmetic, DST-proof). */
export function addDays(iso: string, n: number): string {
  return new Date(noon(iso) + n * DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both yyyy-mm-dd). */
export function diffDays(from: string, to: string): number {
  return Math.round((noon(to) - noon(from)) / DAY);
}

/** Day of week, 0 = Monday … 6 = Sunday. */
export function weekday(iso: string): number {
  return (new Date(noon(iso)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -weekday(iso));
}

/** The 7 dates (Mon → Sun) of the week containing `iso`, shifted by `offset` weeks. */
export function weekDates(iso: string, offset = 0): string[] {
  const mon = addDays(startOfWeek(iso), offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** "today", "tomorrow", "in 12 days", "yesterday", "3 days ago". */
export function relDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return days < 14 || days % 7 ? `in ${days} days` : `in ${days / 7} weeks`;
  return `${-days} days ago`;
}

/** S2·E8 (compact, unpadded — for banners and chips). */
export const epCode = (season: number, number: number) => `S${season}·E${number}`;

/** Stable key for one episode of one show. */
export const episodeKey = (showId: string, season: number, number: number) => `${showId}:${season}:${number}`;

const PLACEHOLDER_NAME = /^(tba|tbd|to be announced|episode\s*#?\s*\d+(\.\d+)?)$/i;

/** True when the provider's name is a real title (not "TBA" / "Episode 8"). */
export function hasRealName(name?: string): name is string {
  return !!name && !!name.trim() && !PLACEHOLDER_NAME.test(name.trim());
}

/**
 * Episode title respecting the spoiler setting: with spoiler-free mode on,
 * unwatched episodes are shown as "Episode 8" (as are unnamed/TBA episodes).
 */
export function episodeTitle(ep: EpisodeRef, opts: { spoilerFree: boolean; watched: boolean }): string {
  if (opts.spoilerFree && !opts.watched) return `Episode ${ep.number}`;
  return hasRealName(ep.name) ? ep.name.trim() : `Episode ${ep.number}`;
}

/** Synopsis, or undefined when hidden by spoiler-free mode. */
export function episodeOverview(ep: EpisodeRef, opts: { spoilerFree: boolean; watched: boolean }): string | undefined {
  if (opts.spoilerFree && !opts.watched) return undefined;
  const o = ep.overview?.replace(/<[^>]+>/g, '').trim();
  return o || undefined;
}

export interface WeekGroup<T> {
  /** Monday, yyyy-mm-dd */
  start: string;
  items: T[];
}

/** Group date-sorted items by Monday-based week. */
export function groupByWeek<T extends { airDate: string }>(items: T[]): WeekGroup<T>[] {
  const out: WeekGroup<T>[] = [];
  for (const it of [...items].sort((a, b) => a.airDate.localeCompare(b.airDate))) {
    const start = startOfWeek(it.airDate);
    const last = out[out.length - 1];
    if (last && last.start === start) last.items.push(it);
    else out.push({ start, items: [it] });
  }
  return out;
}

/** Keys not yet notified, in order; caps the remembered list. */
export function pendingNotifications(keys: string[], notified: string[]): string[] {
  const seen = new Set(notified);
  const out: string[] = [];
  for (const k of keys) if (!seen.has(k) && !out.includes(k)) out.push(k);
  return out;
}

export function rememberNotified(notified: string[], added: string[], cap = 300): string[] {
  const merged = [...notified.filter((k) => !added.includes(k)), ...added];
  return merged.slice(-cap);
}

/** One-line summary for the banner: "Severance S2·E8, The Bear S3·E4 +2 more". */
export function summarizeEpisodes(items: { title: string; season: number; number: number }[], max = 3): string {
  const head = items.slice(0, max).map((i) => `${i.title} ${epCode(i.season, i.number)}`);
  const rest = items.length - head.length;
  return head.join(', ') + (rest > 0 ? ` +${rest} more` : '');
}

/* ───────────── iCalendar ───────────── */

export interface IcsEvent {
  uid: string;
  /** yyyy-mm-dd (all-day event) */
  date: string;
  summary: string;
  description?: string;
  url?: string;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets (UTF-8 aware, never splitting a character). */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const icsDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Build a VCALENDAR of all-day events. Lines end with CRLF as the spec requires. */
export function buildIcs(events: IcsEvent[], opts: { name?: string; now?: Date } = {}): string {
  const stamp = icsStamp(opts.now ?? new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dealo TV//Airing//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (opts.name) lines.push(`X-WR-CALNAME:${icsEscape(opts.name)}`);
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`,
      `SUMMARY:${icsEscape(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** UID for an episode — stable across exports so calendars update instead of duplicating. */
export function episodeUid(showId: string, season: number, number: number): string {
  return `${showId.replace(/[^A-Za-z0-9._-]/g, '-')}-s${season}e${number}@dealo.tv`;
}
