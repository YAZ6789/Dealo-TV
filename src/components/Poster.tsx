import { useRef, useState, type CSSProperties } from 'react';
import type { ShowSummary } from '../types';
import { GENRE_LABELS } from '../lib/genres';
import { useArtwork } from '../providers/artwork';
import { hash } from '../lib/ambient';


const PATTERNS = [
  (h: number) => `repeating-radial-gradient(circle at ${20 + (h % 60)}% ${10 + (h % 50)}%, hsl(${h % 360} 90% 70% / .5) 0 2px, transparent 2px 22px)`,
  (h: number) => `repeating-linear-gradient(${(h % 4) * 45 + 20}deg, hsl(${h % 360} 90% 70% / .35) 0 1px, transparent 1px 14px)`,
  (h: number) =>
    `linear-gradient(hsl(${h % 360} 90% 70% / .3) 1px, transparent 1px) 0 0 / 26px 26px, linear-gradient(90deg, hsl(${h % 360} 90% 70% / .3) 1px, transparent 1px) 0 0 / 26px 26px`,
  (h: number) => `radial-gradient(hsl(${h % 360} 90% 75% / .55) 1.2px, transparent 1.6px) 0 0 / 16px 16px`,
  (h: number) => `conic-gradient(from ${h % 360}deg at 70% 30%, hsl(${h % 360} 90% 60% / .5), transparent 25%, hsl(${(h + 120) % 360} 90% 60% / .4) 50%, transparent 75%)`,
];

/** Procedural cover art for shows without images — unique, deterministic, on-theme. */
export function Art({ show, variant = 'poster' }: { show: Pick<ShowSummary, 'title' | 'year' | 'genres' | 'id'>; variant?: 'poster' | 'wide' | 'hero' }) {
  const h = hash(show.id + show.title);
  const h1 = h % 360;
  const h2 = (h1 + 30 + ((h >> 8) % 90)) % 360;
  const style = {
    '--art-bg': `linear-gradient(${150 + (h % 60)}deg, hsl(${h1} 65% 24%), hsl(${h2} 75% 9%))`,
    '--art-pattern': PATTERNS[h % PATTERNS.length](h >> 3),
  } as CSSProperties;
  const kicker = [show.year, show.genres[0] ? GENRE_LABELS[show.genres[0]] : undefined].filter(Boolean).join(' · ');
  return (
    <div className={`art art--${variant}`} style={style} aria-hidden>
      {kicker && <div className="art__kicker">{kicker}</div>}
      <div className="art__title">{show.title}</div>
    </div>
  );
}

export function Poster({ show, variant = 'poster', eager }: { show: ShowSummary; variant?: 'poster' | 'wide' | 'hero'; eager?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const art = useArtwork(show, anchor);
  const src = variant === 'poster' ? art.poster : art.backdrop ?? art.poster;
  const [failed, setFailed] = useState<string | undefined>();
  return (
    <>
      <span ref={anchor} className="poster-anchor" aria-hidden />
      {!src || failed === src ? (
        <Art show={show} variant={variant} />
      ) : (
        <img key={src} className="fade-img" src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(src)} />
      )}
    </>
  );
}
