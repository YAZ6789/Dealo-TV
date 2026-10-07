import { createStore, del, get, set, clear, type UseStore } from 'idb-keyval';

/**
 * Two-level cache for provider responses: in-memory (per session) + IndexedDB
 * (survives reloads), with TTLs and in-flight request de-duplication.
 */

interface Boxed<T> {
  v: T;
  exp: number;
}

let idb: UseStore | undefined;
function store(): UseStore | undefined {
  if (idb) return idb;
  try {
    if (typeof indexedDB !== 'undefined') idb = createStore('dealo-tv-cache', 'responses');
  } catch {
    idb = undefined;
  }
  return idb;
}

const memory = new Map<string, Boxed<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memory.get(key) as Boxed<T> | undefined;
  if (hit && hit.exp > now) return hit.v;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = (async () => {
    const s = store();
    if (s) {
      try {
        const disk = (await get(key, s)) as Boxed<T> | undefined;
        if (disk && disk.exp > now) {
          memory.set(key, disk);
          return disk.v;
        }
      } catch {
        /* private mode / quota — fall through to network */
      }
    }
    const v = await load();
    const boxed: Boxed<T> = { v, exp: now + ttl };
    memory.set(key, boxed);
    if (s) set(key, boxed, s).catch(() => undefined);
    return v;
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

export async function invalidate(key: string): Promise<void> {
  memory.delete(key);
  const s = store();
  if (s) await del(key, s).catch(() => undefined);
}

export async function clearCache(): Promise<void> {
  memory.clear();
  const s = store();
  if (s) await clear(s).catch(() => undefined);
}
