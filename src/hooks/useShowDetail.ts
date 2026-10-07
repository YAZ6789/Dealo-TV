import { useEffect, useState } from 'react';
import type { ShowDetail, ShowSummary } from '../types';
import { airedSeasonSizes, getDetail } from '../providers';
import { snapshot, useLibrary } from '../store/library';
import { recall, remember } from '../lib/showCache';

interface State {
  detail?: ShowDetail;
  error?: string;
  loading: boolean;
}

/** Load full show detail; keeps the library snapshot (poster, aired episode counts…) fresh. */
export function useShowDetail(id: string): State & { hint?: ShowSummary } {
  const hint = useLibrary((s) => s.entries[id]?.show ?? s.blocked[id]?.show) ?? recall(id);
  const [state, setState] = useState<State>({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    getDetail(id, hint)
      .then((d) => {
        if (!alive) return;
        setState({ detail: d, loading: false });
        remember(snapshot(d));
        const lib = useLibrary.getState();
        if (lib.entries[id] || lib.blocked[id]) lib.refresh(id, snapshot(d), airedSeasonSizes(d));
      })
      .catch((err) => alive && setState({ loading: false, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { ...state, hint };
}
