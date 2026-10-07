import { airedSeasonSizes, getDetail } from '../providers';
import { snapshot, useLibrary } from './library';

let running = false;
const tried = new Set<string>();

/**
 * Background job: fetch details for library entries that are missing episode
 * counts (typical right after a spreadsheet import), so progress bars, "next
 * episode" and imported "S2E5" positions resolve without visiting each page.
 * Polite: two at a time with a pause, watching shows first.
 */
export async function enrichLibrary(limit = 80): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rank = { watching: 0, on_hold: 1, completed: 2, plan: 3, dropped: 4 } as const;
    const todo = Object.values(useLibrary.getState().entries)
      .filter((e) => !e.seasonSizes?.length && !tried.has(e.id) && e.status !== 'plan')
      .sort((a, b) => rank[a.status] - rank[b.status])
      .slice(0, limit);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const e = todo[i++];
        tried.add(e.id);
        try {
          const d = await getDetail(e.id, e.show);
          useLibrary.getState().refresh(e.id, snapshot(d), airedSeasonSizes(d));
        } catch {
          /* offline / unknown — leave as is */
        }
        await new Promise((r) => setTimeout(r, 450));
      }
    };
    await Promise.all([worker(), worker()]);
  } finally {
    running = false;
  }
}
