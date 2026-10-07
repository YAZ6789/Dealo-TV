import { useMemo } from 'react';
import type { ShowSummary, WatchStatus } from '../types';
import { useLibrary } from '../store/library';
import { toast } from '../components/toast';
import { STATUS_LABEL } from '../lib/labels';

/** Library mutations with friendly toasts + undo. */
export function useShowActions() {
  return useMemo(() => {
    const lib = () => useLibrary.getState();
    const snapshotEntry = (id: string) => lib().entries[id];
    const restore = (id: string, prev: ReturnType<typeof snapshotEntry>) => () => {
      if (prev) useLibrary.setState((s) => ({ entries: { ...s.entries, [id]: prev }, updatedAt: new Date().toISOString() }));
      else lib().remove(id);
    };

    return {
      setStatus(show: ShowSummary, status: WatchStatus) {
        const prev = snapshotEntry(show.id);
        if (prev) lib().setStatus(show.id, status);
        else lib().add(show, status, { origin: 'recommendation' });
        toast(`${show.title} → ${STATUS_LABEL[status]}`, { label: 'Undo', run: restore(show.id, prev) });
      },
      watchlist(show: ShowSummary) {
        this.setStatus(show, 'plan');
      },
      seen(show: ShowSummary) {
        this.setStatus(show, 'completed');
      },
      notInterested(show: ShowSummary) {
        const wasBlocked = lib().blocked[show.id];
        lib().block(show, 'not_interested');
        toast(`Won't recommend “${show.title}” again`, {
          label: 'Undo',
          run: () => (wasBlocked ? undefined : lib().unblock(show.id)),
        });
      },
      moreLikeThis(show: ShowSummary) {
        const cur = lib().feedback[show.id]?.value;
        lib().giveFeedback(show, cur === 1 ? 0 : 1);
        toast(cur === 1 ? 'Removed boost' : `Got it — more like “${show.title}”`);
      },
      lessLikeThis(show: ShowSummary) {
        lib().giveFeedback(show, -1);
        toast(`Got it — fewer like “${show.title}”`, { label: 'Undo', run: () => lib().giveFeedback(show, 0) });
      },
      remove(show: ShowSummary) {
        const prev = snapshotEntry(show.id);
        lib().remove(show.id);
        toast(`Removed “${show.title}” from your library`, { label: 'Undo', run: restore(show.id, prev) });
      },
    };
  }, []);
}
