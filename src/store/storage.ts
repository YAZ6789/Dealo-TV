import type { LibraryDoc } from '../types';
import { safeLocalStorage } from './settings';

/**
 * Persistence boundary. The app only ever talks to a StorageAdapter, so cloud
 * sync (Supabase, Firebase, a tiny REST API…) can be added later by writing
 * one more adapter — no changes to the store or UI.
 *
 * A cloud adapter would typically:
 *   load()      → SELECT doc FROM libraries WHERE user_id = auth.uid()
 *   save(doc)   → UPSERT (debounced by the store already)
 *   subscribe() → realtime channel; call back with remote docs whose
 *                 `updatedAt` is newer than ours (the store does the compare)
 */
export interface StorageAdapter {
  readonly name: string;
  load(): Promise<unknown | null>;
  save(doc: LibraryDoc): Promise<void>;
  /** Optional push channel for changes made elsewhere (other tab / device). */
  subscribe?(onRemote: (doc: unknown) => void): () => void;
}

const KEY = 'dealo:library';

export const localAdapter: StorageAdapter = {
  name: 'This browser',
  async load() {
    const raw = safeLocalStorage().getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Keep the corrupt copy around rather than silently losing data.
      safeLocalStorage().setItem(`${KEY}:corrupt:${Date.now()}`, raw);
      return null;
    }
  },
  async save(doc) {
    try {
      safeLocalStorage().setItem(KEY, JSON.stringify(doc));
    } catch (err) {
      // Quota: trim the activity log and retry once.
      const slim = { ...doc, activity: doc.activity.slice(-4000) };
      safeLocalStorage().setItem(KEY, JSON.stringify(slim));
      console.warn('[dealo] storage quota hit — trimmed activity log', err);
    }
  },
  subscribe(onRemote) {
    if (typeof window === 'undefined') return () => undefined;
    const h = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) {
        try {
          onRemote(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  },
};
