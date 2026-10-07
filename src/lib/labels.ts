import type { WatchStatus } from '../types';

export const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: 'Watching',
  plan: 'Watchlist',
  completed: 'Watched',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

export const STATUS_VERB: Record<WatchStatus, string> = {
  watching: 'Watching now',
  plan: 'Want to watch',
  completed: 'Finished',
  on_hold: 'On hold',
  dropped: 'Dropped',
};

export function yearRange(s: { year?: number; endYear?: number; airStatus?: string }): string {
  if (!s.year) return '';
  if (s.endYear && s.endYear !== s.year) return `${s.year}–${s.endYear}`;
  if (s.airStatus === 'ongoing') return `${s.year}–`;
  return String(s.year);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function relTime(iso?: string): string {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysUntil(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00`);
  return Math.round((t - Date.now()) / 86_400_000);
}
