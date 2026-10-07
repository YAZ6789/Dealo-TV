import type { ImportSource } from '../types';
import { fetchSheet } from '../import/sheets';
import { planSync } from '../import/sync';
import { searchShows } from '../providers';
import { toast } from '../components/toast';
import { useLibrary } from './library';
import { enrichLibrary } from './enrich';

/**
 * Background Google Sheets sync. Every connected sheet (with auto-sync on) is
 * re-read when the app opens, when you come back to the tab, and every 15
 * minutes while it's open; only rows edited in the sheet are applied.
 */

const INTERVAL = 15 * 60_000;
const MIN_GAP = 4 * 60_000;
const running = new Set<string>();

export interface SyncOutcome {
  added: number;
  updated: number;
  blocked: number;
  pending: number;
  error?: string;
}

export async function syncSource(id: string, opts: { quiet?: boolean } = {}): Promise<SyncOutcome | undefined> {
  if (running.has(id)) return undefined;
  const src = useLibrary.getState().importSources.find((s) => s.id === id);
  if (!src) return undefined;
  running.add(id);
  const at = new Date().toISOString();
  try {
    const table = await fetchSheet(src.url, src.tab);
    const lib = useLibrary.getState();
    const plan = await planSync(table, src, { entries: lib.entries, blocked: lib.blocked, search: searchShows });
    const res = plan.actions.length ? useLibrary.getState().applyImport(plan.actions) : { added: 0, updated: 0, blocked: 0 };
    const outcome: SyncOutcome = { ...res, pending: plan.pending.length };
    save(src, { rowState: plan.rowState, links: plan.links, lastSyncAt: at, lastSync: { at, ...outcome } });
    if (res.added + res.updated + res.blocked > 0) void enrichLibrary(60);
    if (!opts.quiet || res.added + res.updated + res.blocked > 0 || plan.pending.length) report(src, outcome);
    return outcome;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    save(src, { lastSync: { at, added: 0, updated: 0, blocked: 0, pending: 0, error } });
    if (!opts.quiet) toast(`Couldn't sync “${src.label}”: ${error}`);
    return { added: 0, updated: 0, blocked: 0, pending: 0, error };
  } finally {
    running.delete(id);
  }
}

function save(src: ImportSource, patch: Partial<ImportSource>) {
  const cur = useLibrary.getState().importSources.find((s) => s.id === src.id) ?? src;
  useLibrary.getState().upsertImportSource({ ...cur, ...patch });
}

function report(src: ImportSource, o: SyncOutcome) {
  const parts = [o.added && `${o.added} added`, o.updated && `${o.updated} updated`, o.blocked && `${o.blocked} hidden`].filter(Boolean);
  const head = parts.length ? `“${src.label}” synced — ${parts.join(', ')}` : `“${src.label}” is up to date`;
  if (o.pending)
    toast(`${head}. ${o.pending} new row${o.pending > 1 ? 's' : ''} need${o.pending > 1 ? '' : 's'} a quick review`, {
      label: 'Review',
      run: () => {
        location.hash = `#/settings/import?source=${encodeURIComponent(src.id)}`;
      },
    });
  else toast(head);
}

/** Sync every auto-sync sheet that hasn't been synced in the last few minutes. */
export async function syncAll(force = false): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const now = Date.now();
  for (const s of useLibrary.getState().importSources) {
    if (s.autoSync === false) continue;
    if (!force && s.lastSync && now - Date.parse(s.lastSync.at) < MIN_GAP) continue;
    await syncSource(s.id, { quiet: true });
  }
}

let started = false;

export function startSheetAutoSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  setTimeout(() => void syncAll(), 5000);
  setInterval(() => void syncAll(), INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncAll();
  });
  window.addEventListener('online', () => void syncAll());
}
