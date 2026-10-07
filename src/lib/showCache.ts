import type { ShowSummary } from '../types';

/**
 * Session memory of summaries we've rendered, so a show page can paint
 * instantly (and resolve ids that need a hint, like custom imports) before
 * the detail request finishes.
 */
const mem = new Map<string, ShowSummary>();
const KEY = 'dealo:seen';

function load() {
  if (mem.size) return;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) for (const s of JSON.parse(raw) as ShowSummary[]) mem.set(s.id, s);
  } catch {
    /* ignore */
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify([...mem.values()].slice(-300)));
    } catch {
      /* ignore */
    }
  }, 500);
}

export function remember(...shows: ShowSummary[]): void {
  load();
  for (const s of shows) {
    const prev = mem.get(s.id);
    mem.set(s.id, prev ? { ...prev, ...s } : s);
  }
  persist();
}

export function recall(id: string): ShowSummary | undefined {
  load();
  return mem.get(id);
}

export const showPath = (id: string) => `/show/${encodeURIComponent(id)}`;
