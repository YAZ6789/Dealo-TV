import { useEffect } from 'react';

type Handler = (e: KeyboardEvent) => void;

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/** keys like "mod+k", "/", "alt+t", "escape". `mod` = ⌘ on macOS, Ctrl elsewhere. */
export function useHotkeys(map: Record<string, Handler>, deps: unknown[] = []) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      for (const [combo, fn] of Object.entries(map)) {
        const parts = combo.toLowerCase().split('+');
        const key = parts.pop()!;
        const mod = parts.includes('mod');
        const alt = parts.includes('alt');
        const shift = parts.includes('shift');
        if (mod !== (e.metaKey || e.ctrlKey) || alt !== e.altKey || shift !== e.shiftKey) continue;
        const k = e.key.toLowerCase();
        const code = e.code.toLowerCase();
        if (k !== key && code !== `key${key}`) continue;
        if (!mod && !alt && isTyping(e)) continue;
        e.preventDefault();
        fn(e);
        return;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
