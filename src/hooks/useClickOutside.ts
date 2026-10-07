import { useEffect, type RefObject } from 'react';

export function useClickOutside(refs: RefObject<HTMLElement | null>[], onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      onOutside();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onOutside();
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('pointerdown', h);
      document.removeEventListener('keydown', k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
