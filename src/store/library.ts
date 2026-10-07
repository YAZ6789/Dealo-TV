import { create } from 'zustand';
import type {
  ActivityEvent,
  Affinity,
  BlockReason,
  GenreKey,
  ImportSource,
  LibraryDoc,
  LibraryEntry,
  Position,
  ShowId,
  ShowSummary,
  TasteProfile,
  WatchStatus,
} from '../types';
import { allWatched, positionToWatched, totalEpisodes, watchedCount } from '../lib/progress';
import { localAdapter, type StorageAdapter } from './storage';
import type { ImportAction } from '../import/plan';

export const DOC_VERSION = 1;
const MAX_ACTIVITY = 20_000;

export const defaultTaste = (): TasteProfile => ({
  genres: {},
  keywords: {},
  preferences: { languages: [], adventurousness: 0.35, obscurity: 0.35 },
});

export const emptyDoc = (): LibraryDoc => ({
  version: DOC_VERSION,
  entries: {},
  blocked: {},
  feedback: {},
  taste: defaultTaste(),
  activity: [],
  importSources: [],
  updatedAt: new Date(0).toISOString(),
});

/** Validate + upgrade anything that claims to be a LibraryDoc (storage, backups). */
export function migrateDoc(raw: unknown): LibraryDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Dealo TV backup');
  const d = raw as Partial<LibraryDoc>;
  if (typeof d.entries !== 'object' || d.entries === null) throw new Error('Backup has no library entries');
  const base = emptyDoc();
  const taste = { ...base.taste, ...(d.taste ?? {}) };
  taste.preferences = { ...base.taste.preferences, ...(d.taste?.preferences ?? {}) };
  const entries: Record<ShowId, LibraryEntry> = {};
  for (const [id, e] of Object.entries(d.entries)) {
    if (!e || typeof e !== 'object' || !e.show?.title) continue;
    entries[id] = { ...e, id, watched: e.watched ?? {}, show: { ...e.show, genres: e.show.genres ?? [] } };
  }
  return {
    version: DOC_VERSION,
    entries,
    blocked: d.blocked ?? {},
    feedback: d.feedback ?? {},
    taste,
    activity: Array.isArray(d.activity) ? d.activity : [],
    importSources: Array.isArray(d.importSources) ? d.importSources : [],
    updatedAt: d.updatedAt ?? new Date().toISOString(),
  };
}

const now = () => new Date().toISOString();

/** Keep only the persisted-worthy subset of a summary (drops big arrays like related shows). */
export function snapshot(s: ShowSummary): ShowSummary {
  const {
    id, source, title, originalTitle, year, endYear, overview, poster, backdrop, genres, keywords, networks, creators, cast,
    language, country, rating, votes, popularity, airStatus, seasonCount, episodeCount, runtime, externalIds,
  } = s;
  return {
    id, source, title, originalTitle, year, endYear, overview: overview?.slice(0, 600), poster, backdrop, genres,
    keywords: keywords?.slice(0, 30), networks, creators: creators?.slice(0, 4), cast: cast?.slice(0, 6), language, country,
    rating, votes, popularity, airStatus, seasonCount, episodeCount, runtime, externalIds,
  };
}

export interface AddOptions {
  rating?: number;
  origin?: LibraryEntry['origin'];
  position?: Position;
  notes?: string;
  favorite?: boolean;
  startedAt?: string;
  completedAt?: string;
  seasonSizes?: number[];
}

export interface LibraryState extends LibraryDoc {
  hydrated: boolean;
  adapter: StorageAdapter;

  add: (show: ShowSummary, status: WatchStatus, opts?: AddOptions) => void;
  remove: (id: ShowId) => void;
  setStatus: (id: ShowId, status: WatchStatus) => void;
  rate: (id: ShowId, rating: number | undefined) => void;
  toggleFavorite: (id: ShowId) => void;
  setNotes: (id: ShowId, notes: string) => void;

  toggleEpisode: (id: ShowId, season: number, episode: number, runtime?: number) => void;
  markUpTo: (id: ShowId, season: number, episode: number, runtime?: number) => void;
  setSeasonWatched: (id: ShowId, season: number, count: number, watched: boolean, runtime?: number) => void;
  /** Store fresh metadata (poster, aired episode counts…) on an existing entry. */
  refresh: (id: ShowId, show: ShowSummary, seasonSizes?: number[]) => void;
  /** Move an entry to a new id (e.g. catalog → TMDB after adding a key). */
  rekey: (oldId: ShowId, show: ShowSummary) => void;

  block: (show: ShowSummary, reason?: BlockReason) => void;
  unblock: (id: ShowId) => void;
  giveFeedback: (show: ShowSummary, value: 1 | -1 | 0) => void;

  setGenre: (g: GenreKey, v: Affinity | 0) => void;
  setKeyword: (k: string, v: Affinity | 0) => void;
  setPreferences: (p: Partial<TasteProfile['preferences']>) => void;

  /** Apply a planned spreadsheet import in one atomic update. */
  applyImport: (actions: ImportAction[]) => { added: number; updated: number; blocked: number };
  upsertImportSource: (src: ImportSource) => void;
  removeImportSource: (id: string) => void;

  replaceDoc: (doc: LibraryDoc) => void;
  mergeDoc: (doc: LibraryDoc) => void;
  exportDoc: () => LibraryDoc;
  reset: () => void;
}

type Set = (fn: (s: LibraryState) => Partial<LibraryState>) => void;

function patchEntry(set: Set, id: ShowId, fn: (e: LibraryEntry, s: LibraryState) => Partial<LibraryEntry> | null, events: Omit<ActivityEvent, 'at' | 'id'>[] = []) {
  set((s) => {
    const e = s.entries[id];
    if (!e) return {};
    const p = fn(e, s);
    if (!p) return {};
    const at = now();
    return {
      entries: { ...s.entries, [id]: { ...e, ...p, updatedAt: at } },
      activity: pushActivity(s.activity, events.map((ev) => ({ ...ev, id, at }))),
      updatedAt: at,
    };
  });
}

function pushActivity(list: ActivityEvent[], add: ActivityEvent[]): ActivityEvent[] {
  if (!add.length) return list;
  const next = list.concat(add);
  return next.length > MAX_ACTIVITY ? next.slice(next.length - MAX_ACTIVITY) : next;
}

/** After episode changes: plan → watching, everything aired + ended → completed. */
function autoStatus(e: LibraryEntry, watched: Record<string, number[]>): Partial<LibraryEntry> {
  const out: Partial<LibraryEntry> = {};
  const count = watchedCount(watched);
  const total = totalEpisodes(e.seasonSizes);
  if (count > 0 && (e.status === 'plan' || e.status === 'on_hold' || e.status === 'dropped')) {
    out.status = 'watching';
    out.startedAt = e.startedAt ?? now();
  }
  if (total > 0 && count >= total && e.show.airStatus === 'ended' && e.status !== 'completed') {
    out.status = 'completed';
    out.completedAt = now();
  }
  if (total > 0 && count < total && e.status === 'completed') out.status = 'watching';
  return out;
}

function sortedUnique(list: number[]): number[] {
  return [...new Set(list)].sort((a, b) => a - b);
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  ...emptyDoc(),
  hydrated: false,
  adapter: localAdapter,

  add(show, status, opts = {}) {
    const at = now();
    set((s) => {
      const prev = s.entries[show.id];
      const sizes = opts.seasonSizes ?? prev?.seasonSizes;
      let watched = prev?.watched ?? {};
      if (!watchedCount(watched) && opts.position && sizes?.length) watched = positionToWatched(opts.position, sizes);
      if (status === 'completed' && sizes?.length && !watchedCount(watched)) watched = allWatched(sizes);
      const entry: LibraryEntry = {
        id: show.id,
        show: snapshot(show),
        status,
        watched,
        seasonSizes: sizes,
        rating: opts.rating ?? prev?.rating,
        favorite: opts.favorite ?? prev?.favorite,
        notes: opts.notes ?? prev?.notes,
        position: opts.position ?? prev?.position,
        addedAt: prev?.addedAt ?? at,
        updatedAt: at,
        startedAt: opts.startedAt ?? prev?.startedAt ?? (status === 'watching' ? at : undefined),
        completedAt: opts.completedAt ?? prev?.completedAt ?? (status === 'completed' ? at : undefined),
        origin: prev?.origin ?? opts.origin ?? 'manual',
      };
      const blocked = { ...s.blocked };
      delete blocked[show.id];
      const events: ActivityEvent[] = [{ kind: prev ? 'status' : 'add', id: show.id, at, status }];
      if (opts.rating != null) events.push({ kind: 'rating', id: show.id, at, rating: opts.rating });
      return { entries: { ...s.entries, [show.id]: entry }, blocked, activity: pushActivity(s.activity, events), updatedAt: at };
    });
  },

  remove(id) {
    set((s) => {
      const entries = { ...s.entries };
      delete entries[id];
      return { entries, updatedAt: now() };
    });
  },

  setStatus(id, status) {
    patchEntry(
      set,
      id,
      (e) => {
        if (e.status === status && status !== 'completed') return null;
        const p: Partial<LibraryEntry> = { status };
        if (status === 'watching' && !e.startedAt) p.startedAt = now();
        if (status === 'completed') {
          p.completedAt = now();
          if (e.seasonSizes?.length) p.watched = allWatched(e.seasonSizes);
          if (e.status === 'completed') p.rewatchCount = (e.rewatchCount ?? 0) + 1;
        }
        return p;
      },
      [{ kind: 'status', status }],
    );
  },

  rate(id, rating) {
    patchEntry(set, id, () => ({ rating }), rating != null ? [{ kind: 'rating', rating }] : []);
  },

  toggleFavorite(id) {
    patchEntry(set, id, (e) => ({ favorite: !e.favorite }));
  },

  setNotes(id, notes) {
    patchEntry(set, id, () => ({ notes: notes || undefined }));
  },

  toggleEpisode(id, season, episode, runtime) {
    const e = get().entries[id];
    if (!e) return;
    const list = e.watched[season] ?? [];
    const has = list.includes(episode);
    const minutes = runtime ?? e.show.runtime;
    patchEntry(
      set,
      id,
      (cur) => {
        const watched: Record<string, number[]> = { ...cur.watched, [season]: has ? list.filter((x) => x !== episode) : sortedUnique([...list, episode]) };
        if (!watched[season].length) delete watched[season];
        return { watched, lastWatchedAt: has ? cur.lastWatchedAt : now(), position: undefined, ...autoStatus(cur, watched) };
      },
      [{ kind: has ? 'unepisode' : 'episode', season, episode, minutes }],
    );
  },

  markUpTo(id, season, episode, runtime) {
    const e = get().entries[id];
    if (!e?.seasonSizes?.length) return;
    const target = positionToWatched({ season, episode }, e.seasonSizes);
    const events: Omit<ActivityEvent, 'at' | 'id'>[] = [];
    const minutes = runtime ?? e.show.runtime;
    for (const [s, eps] of Object.entries(target)) {
      const have = new Set(e.watched[s] ?? []);
      for (const n of eps) if (!have.has(n)) events.push({ kind: 'episode', season: Number(s), episode: n, minutes });
    }
    patchEntry(
      set,
      id,
      (cur) => {
        const watched: Record<string, number[]> = { ...cur.watched };
        for (const [s, eps] of Object.entries(target)) watched[s] = sortedUnique([...(watched[s] ?? []), ...eps]);
        return { watched, lastWatchedAt: now(), position: undefined, ...autoStatus(cur, watched) };
      },
      events,
    );
  },

  setSeasonWatched(id, season, count, value, runtime) {
    const e = get().entries[id];
    if (!e) return;
    const minutes = runtime ?? e.show.runtime;
    const have = new Set(e.watched[season] ?? []);
    const events: Omit<ActivityEvent, 'at' | 'id'>[] = [];
    for (let n = 1; n <= count; n++) {
      if (value && !have.has(n)) events.push({ kind: 'episode', season, episode: n, minutes });
      if (!value && have.has(n)) events.push({ kind: 'unepisode', season, episode: n, minutes });
    }
    patchEntry(
      set,
      id,
      (cur) => {
        const watched = { ...cur.watched };
        if (value) watched[season] = Array.from({ length: count }, (_, i) => i + 1);
        else delete watched[season];
        return { watched, lastWatchedAt: value ? now() : cur.lastWatchedAt, position: undefined, ...autoStatus(cur, watched) };
      },
      events,
    );
  },

  refresh(id, show, seasonSizes) {
    set((s) => {
      const e = s.entries[id];
      const b = s.blocked[id];
      const out: Partial<LibraryState> = {};
      if (e) {
        const sizes = seasonSizes?.length ? seasonSizes : e.seasonSizes;
        let watched = e.watched;
        // Resolve an imported "S2E5" position or a completed show into real episode ticks.
        if (sizes?.length && !watchedCount(watched)) {
          if (e.status === 'completed') watched = allWatched(sizes);
          else if (e.position) watched = positionToWatched(e.position, sizes);
        }
        const merged = snapshot({ ...e.show, ...show, keywords: show.keywords?.length ? show.keywords : e.show.keywords });
        const same = JSON.stringify(merged) === JSON.stringify(e.show) && JSON.stringify(sizes) === JSON.stringify(e.seasonSizes) && watched === e.watched;
        if (!same) out.entries = { ...s.entries, [id]: { ...e, show: merged, seasonSizes: sizes, watched } };
      }
      if (b) out.blocked = { ...s.blocked, [id]: { ...b, show: snapshot({ ...b.show, ...show }) } };
      if (out.entries || out.blocked) out.updatedAt = new Date().toISOString(); // persist the refresh
      return out;
    });
  },

  rekey(oldId, show) {
    set((s) => {
      const e = s.entries[oldId];
      if (!e || oldId === show.id) return {};
      const entries = { ...s.entries };
      delete entries[oldId];
      const existing = entries[show.id];
      entries[show.id] = {
        ...(existing ?? e),
        ...e,
        id: show.id,
        show: snapshot({ ...e.show, ...show, externalIds: { ...e.show.externalIds, ...show.externalIds } }),
        updatedAt: now(),
      };
      const activity = s.activity.map((a) => (a.id === oldId ? { ...a, id: show.id } : a));
      return { entries, activity, updatedAt: now() };
    });
  },

  block(show, reason = 'not_interested') {
    set((s) => {
      const feedback = { ...s.feedback };
      delete feedback[show.id];
      return { blocked: { ...s.blocked, [show.id]: { id: show.id, show: snapshot(show), at: now(), reason } }, feedback, updatedAt: now() };
    });
  },

  unblock(id) {
    set((s) => {
      const blocked = { ...s.blocked };
      delete blocked[id];
      return { blocked, updatedAt: now() };
    });
  },

  giveFeedback(show, value) {
    set((s) => {
      const feedback = { ...s.feedback };
      if (value === 0) delete feedback[show.id];
      else feedback[show.id] = { id: show.id, show: snapshot(show), value, at: now() };
      return { feedback, updatedAt: now() };
    });
  },

  setGenre(g, v) {
    set((s) => {
      const genres = { ...s.taste.genres };
      if (v === 0) delete genres[g];
      else genres[g] = v;
      return { taste: { ...s.taste, genres }, updatedAt: now() };
    });
  },

  setKeyword(k, v) {
    set((s) => {
      const keywords = { ...s.taste.keywords };
      if (v === 0) delete keywords[k];
      else keywords[k] = v;
      return { taste: { ...s.taste, keywords }, updatedAt: now() };
    });
  },

  setPreferences(p) {
    set((s) => ({ taste: { ...s.taste, preferences: { ...s.taste.preferences, ...p } }, updatedAt: now() }));
  },

  applyImport(actions) {
    const at = now();
    const res = { added: 0, updated: 0, blocked: 0 };
    set((s) => {
      const entries = { ...s.entries };
      const blocked = { ...s.blocked };
      const events: ActivityEvent[] = [];
      for (const a of actions) {
        const id = a.show.id;
        const p = a.patch;
        if (a.kind === 'add' && p.status) {
          let watched: Record<string, number[]> = {};
          const sizes = entries[id]?.seasonSizes;
          if (sizes?.length && p.position) watched = positionToWatched(p.position, sizes);
          if (sizes?.length && p.status === 'completed') watched = allWatched(sizes);
          entries[id] = {
            id,
            show: snapshot(a.show),
            status: p.status,
            rating: p.rating,
            notes: p.notes,
            favorite: p.favorite,
            position: p.position,
            watched,
            addedAt: at,
            updatedAt: at,
            startedAt: p.startedAt,
            completedAt: p.completedAt,
            origin: 'import',
          };
          delete blocked[id];
          events.push({ kind: 'add', id, at, status: p.status });
          res.added++;
        } else if (a.kind === 'update' && entries[id]) {
          const e = entries[id];
          const next: LibraryEntry = { ...e, updatedAt: at };
          if (p.status) next.status = p.status;
          if (p.rating != null) next.rating = p.rating;
          if (p.notes != null) next.notes = p.notes;
          if (p.favorite != null) next.favorite = p.favorite;
          if (p.startedAt) next.startedAt = p.startedAt;
          if (p.completedAt) next.completedAt = p.completedAt;
          if (p.position) {
            next.position = p.position;
            if (e.seasonSizes?.length) {
              const target = positionToWatched(p.position, e.seasonSizes);
              const merged: Record<string, number[]> = { ...e.watched };
              for (const [k, eps] of Object.entries(target)) merged[k] = [...new Set([...(merged[k] ?? []), ...eps])].sort((x, y) => x - y);
              next.watched = merged;
            }
          }
          if (p.status === 'completed' && e.seasonSizes?.length) next.watched = allWatched(e.seasonSizes);
          entries[id] = next;
          if (p.status) events.push({ kind: 'status', id, at, status: p.status });
          res.updated++;
        } else if (a.kind === 'block') {
          blocked[id] = { id, show: snapshot(a.show), at, reason: 'not_interested' };
          delete entries[id];
          res.blocked++;
        }
      }
      return { entries, blocked, activity: pushActivity(s.activity, events), updatedAt: at };
    });
    return res;
  },

  upsertImportSource(src) {
    set((s) => {
      const list = s.importSources.filter((x) => x.id !== src.id);
      return { importSources: [...list, src], updatedAt: now() };
    });
  },

  removeImportSource(id) {
    set((s) => ({ importSources: s.importSources.filter((x) => x.id !== id), updatedAt: now() }));
  },

  replaceDoc(doc) {
    set(() => ({ ...migrateDoc(doc), updatedAt: now() }));
  },

  mergeDoc(raw) {
    const doc = migrateDoc(raw);
    set((s) => {
      const entries = { ...s.entries };
      for (const [id, e] of Object.entries(doc.entries)) {
        const mine = entries[id];
        entries[id] = !mine || e.updatedAt > mine.updatedAt ? e : mine;
      }
      const seen = new Set(s.activity.map((a) => `${a.id}|${a.at}|${a.kind}|${a.season}|${a.episode}`));
      const extra = doc.activity.filter((a) => !seen.has(`${a.id}|${a.at}|${a.kind}|${a.season}|${a.episode}`));
      return {
        entries,
        blocked: { ...doc.blocked, ...s.blocked },
        feedback: { ...doc.feedback, ...s.feedback },
        taste: {
          genres: { ...doc.taste.genres, ...s.taste.genres },
          keywords: { ...doc.taste.keywords, ...s.taste.keywords },
          preferences: { ...doc.taste.preferences, ...s.taste.preferences },
        },
        activity: pushActivity(s.activity, extra).sort((a, b) => a.at.localeCompare(b.at)),
        importSources: [...s.importSources, ...doc.importSources.filter((x) => !s.importSources.some((y) => y.id === x.id))],
        updatedAt: now(),
      };
    });
  },

  exportDoc() {
    const s = get();
    return {
      version: DOC_VERSION,
      entries: s.entries,
      blocked: s.blocked,
      feedback: s.feedback,
      taste: s.taste,
      activity: s.activity,
      importSources: s.importSources,
      updatedAt: s.updatedAt,
    };
  },

  reset() {
    set(() => ({ ...emptyDoc(), updatedAt: now() }));
  },
}));

/* ───────────────────────── persistence wiring ───────────────────────── */

let started = false;

/** Load from the adapter, then autosave (debounced) and listen for remote changes. */
export async function initLibrary(adapter: StorageAdapter = localAdapter): Promise<void> {
  if (started) return;
  started = true;
  try {
    const raw = await adapter.load();
    const doc = raw ? migrateDoc(raw) : emptyDoc();
    useLibrary.setState({ ...doc, adapter, hydrated: true });
  } catch (err) {
    console.error('[dealo] failed to load library', err);
    // Keep the unreadable copy before autosave can overwrite it.
    try {
      const raw = await adapter.load();
      if (raw) localStorage.setItem(`dealo:library:unreadable:${Date.now()}`, JSON.stringify(raw));
    } catch {
      /* nothing more we can do */
    }
    useLibrary.setState({ adapter, hydrated: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = useLibrary.getState().updatedAt;
  useLibrary.subscribe((s) => {
    if (!s.hydrated || s.updatedAt === lastSaved) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const doc = useLibrary.getState().exportDoc();
      lastSaved = doc.updatedAt;
      adapter.save(doc).catch((e) => console.error('[dealo] save failed', e));
    }, 250);
  });

  adapter.subscribe?.((remote) => {
    try {
      const doc = migrateDoc(remote);
      if (doc.updatedAt > useLibrary.getState().updatedAt) {
        lastSaved = doc.updatedAt;
        useLibrary.setState({ ...doc });
      }
    } catch {
      /* ignore malformed remote docs */
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      const s = useLibrary.getState();
      if (s.updatedAt !== lastSaved) void adapter.save(s.exportDoc());
    });
  }
}
