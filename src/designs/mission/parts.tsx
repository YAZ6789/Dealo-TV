import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ShowSummary } from '../../types';
import { remember, showPath } from '../../lib/showCache';
import { useSettings } from '../../store/settings';
import { Poster } from '../../components/Poster';

/* ───────────── hooks ───────────── */

/** OS reduced-motion preference or the app's "reduce effects" setting. */
export function useReducedMotion(): boolean {
  const reduceFx = useSettings((s) => s.reduceFx);
  return usePrefersReducedMotion() || reduceFx;
}

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Eased count-up towards `target` (instant with reduced motion). */
export function useCountUp(target: number, duration = 1200): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const cur = useRef(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      cur.current = target;
      setValue(target);
      return;
    }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      cur.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return value;
}

/* ───────────── building blocks ───────────── */

let dotSeq = 0;

export function Panel({
  id,
  label,
  meta,
  action,
  className = '',
  children,
}: {
  id: string;
  label: string;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  // Staggered blink so the dots don't pulse in lockstep.
  const [delay] = useState(() => `${((dotSeq++ * 0.37) % 2.4).toFixed(2)}s`);
  return (
    <section className={`panel mc-panel ${className}`} aria-labelledby={`mc-h-${id}`}>
      <header className="mc-panel__head">
        <span className="mc-dot" style={{ animationDelay: delay }} aria-hidden />
        <h2 className="mc-panel__label" id={`mc-h-${id}`}>
          {label}
        </h2>
        {meta != null && <span className="mc-panel__meta">{meta}</span>}
        {action && <span className="mc-panel__action">{action}</span>}
      </header>
      <div className="mc-panel__body">{children}</div>
    </section>
  );
}

/** Link to a show page that primes the show cache first. */
export function ShowLink({ show, className, children, label }: { show: ShowSummary; className?: string; children: ReactNode; label?: string }) {
  return (
    <Link to={showPath(show.id)} onClick={() => remember(show)} className={className} aria-label={label}>
      {children}
    </Link>
  );
}

/** Small 2:3 poster thumbnail (decorative; the title is always printed next to it). */
export function Thumb({ show, size = 'sm' }: { show: ShowSummary; size?: 'sm' | 'md' }) {
  return (
    <span className={`mc-thumb mc-thumb--${size}`} aria-hidden>
      <Poster show={show} variant="poster" />
    </span>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div className="mc-state" role="status">
      <span className="spinner mc-state__spin" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="mc-state mc-state--empty">
      <strong>{title}</strong>
      {hint && <span className="mc-state__hint">{hint}</span>}
      {children}
    </div>
  );
}

export const countdown = (days: number): string =>
  days < -1 ? `aired ${-days} days ago` : days === -1 ? 'aired yesterday' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
