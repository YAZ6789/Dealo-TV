import { useEffect } from 'react';
import { ensureRecommendations, useRecs } from '../recommend/pipeline';
import { useLibrary } from '../store/library';

export function useRecommendations() {
  const hydrated = useLibrary((s) => s.hydrated);
  const st = useRecs();
  useEffect(() => {
    if (hydrated) void ensureRecommendations();
  }, [hydrated]);
  return st;
}
