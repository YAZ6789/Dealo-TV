import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { defaultCollection, useCollections, type CollectionId, type Item } from './useCollections';
import { HudSheet, ShowHud, useCalmFx, useCompact, useFitArtTitles } from './ShowHud';
import { Poster } from '../components/Poster';
import { remember, showPath } from '../lib/showCache';

/**
 * WARP TUNNEL — fly down a neon corridor. Posters line the walls; scroll,
 * swipe/drag or use ↑/↓ to travel. Your history track has glowing year gates;
 * the "For you" track gates every ten picks. The nearest show ahead is decoded
 * in the HUD below (a one-glance strip on phones, full readout on tap).
 */

const SPACING = 440;
const GRID = 110; // corridor grid cell, see .tunnel-plane background-size
/** Long names for the wide layout; phones use the collection's own short label. */
const TRACK_LABEL: Partial<Record<CollectionId, string>> = {
  watched: 'Into the past · Watched',
  continue: 'Watching now',
  foryou: 'Into the future · For you',
};

interface Gate {
  z: number;
  label: string;
}

export default function WarpTunnel() {
  const { collections } = useCollections();
  const nav = useNavigate();
  const compact = useCompact();
  const calm = useCalmFx();
  // Opens on your library until you pick a track yourself.
  const [picked, setTid] = useState<CollectionId | null>(null);
  const tid = picked ?? defaultCollection(collections);
  // Same order as everywhere else: Watched → Watching → Watchlist → On hold, recommendations last.
  const tracks = collections.filter((c) => c.items.length);
  const items: Item[] = useMemo(() => {
    const c = collections.find((x) => x.id === tid);
    const list = (c?.items ?? []).slice(0, 60);
    if (tid === 'watched') return [...list].sort((a, b) => (b.entry?.completedAt ?? b.entry?.updatedAt ?? '').localeCompare(a.entry?.completedAt ?? a.entry?.updatedAt ?? ''));
    return list;
  }, [collections, tid]);

  const [vw, setVw] = useState(() => innerWidth);
  const [vh, setVh] = useState(() => innerHeight);
  useEffect(() => {
    const h = () => {
      setVw(innerWidth);
      setVh(innerHeight);
    };
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, []);
  const landscapePhone = compact && vh < 520 && vw > vh;
  // Phones: cards sized to the room left between the track chips and the HUD strip.
  const cardW = compact ? Math.round(Math.max(84, Math.min(150, vw * 0.36, (vh - 330) / 2))) : Math.max(130, Math.min(230, vw * 0.15));
  const lane = compact ? Math.min((landscapePhone ? vw * 0.58 : vw) * 0.3, 260) : Math.min(vw * 0.3, 430);
  const wallX = lane + cardW * 0.9;
  const H = Math.min(vh * 0.95, 900);
  /** How far the camera leans towards the focused card (phones centre it more). */
  const lean = compact ? 0.62 : 0.35;

  const pos = (i: number) => ({ x: i % 2 === 0 ? -lane : lane, y: (i % 3) * 18 - 30, z: -i * SPACING - 260 });

  const gates: Gate[] = useMemo(() => {
    const out: Gate[] = [];
    if (tid === 'watched') {
      let last = '';
      items.forEach((it, i) => {
        const y = (it.entry?.completedAt ?? it.entry?.updatedAt ?? '').slice(0, 4);
        if (y && y !== last) {
          if (i > 0) out.push({ z: -i * SPACING - 40, label: y });
          last = y;
        }
      });
    } else if (tid === 'foryou') {
      for (let i = 10; i < items.length; i += 10) out.push({ z: -i * SPACING - 40, label: `${i + 1}–${Math.min(items.length, i + 10)}` });
    }
    return out;
  }, [items, tid]);

  /* ── camera ── */
  const world = useRef<HTMLDivElement>(null);
  const corridor = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const tracksNav = useRef<HTMLElement>(null);
  const target = useRef(0);
  const cam = useRef(0);
  const raf = useRef(0);
  const [focus, setFocus] = useState(0);
  const [warping, setWarping] = useState(false);
  const [sheet, setSheet] = useState(false);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const maxCam = Math.max(0, (items.length - 1) * SPACING);
  useFitArtTitles(view, [items, cardW]);

  // The frame loop only runs while the camera is travelling; at rest it stops (battery).
  const frame = useRef<() => void>(() => {});
  frame.current = () => {
    const prev = cam.current;
    cam.current += (target.current - cam.current) * (calm ? 0.2 : 0.1);
    const settled = Math.abs(target.current - cam.current) < 0.3 && !drag.current;
    if (settled) cam.current = target.current;
    const v = Math.abs(cam.current - prev);
    const f = Math.max(0, Math.min(items.length - 1, Math.round(cam.current / SPACING)));
    const fp = pos(f);
    if (world.current) world.current.style.transform = `translate3d(${-fp.x * lean}px, 0, ${cam.current}px)`;
    // The corridor is a few screens long and hops forward with the camera, one grid cell at a time.
    if (corridor.current) corridor.current.style.transform = `translate3d(0, 0, ${-Math.floor(cam.current / GRID) * GRID}px)`;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const z = -i * SPACING - 260 + cam.current;
      const o = z > 200 ? 0 : z > -200 ? 1 : Math.max(0, 1 + (z + 200) / 3600);
      el.style.opacity = String(o);
      el.style.visibility = o < 0.02 ? 'hidden' : '';
      el.style.pointerEvents = o < 0.2 ? 'none' : 'auto';
    });
    setFocus(f);
    setWarping(!calm && v > 18);
    raf.current = settled ? 0 : requestAnimationFrame(() => frame.current());
  };
  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(() => frame.current());
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  useEffect(() => {
    target.current = 0;
    cam.current = 0;
    setFocus(0);
    setSheet(false);
    kick();
  }, [tid, kick]);
  // re-place on layout changes (resize / rotation)
  useEffect(kick, [kick, lane, cardW, items.length]);

  // Keep the chosen track chip visible in the scrolling row (phones).
  useEffect(() => {
    const row = tracksNav.current;
    const on = row?.querySelector<HTMLElement>('button.on');
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2), behavior: calm ? 'auto' : 'smooth' });
  }, [tid, calm, tracks.length]);

  const go = (d: number) => {
    target.current = Math.max(0, Math.min(maxCam, Math.round(target.current / SPACING + d) * SPACING));
    kick();
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="menu"], .menu') || document.querySelector('.overlay, .hud-sheet-wrap')) return;
      if (e.key === 'Enter' && t.closest('button, a')) return; // let focused controls handle Enter
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Enter' && items[focus]) {
        remember(items[focus].show);
        nav(showPath(items[focus].show.id));
      } else return;
      e.preventDefault();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const snapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  onWheel.current = (e) => {
    if ((e.target as HTMLElement).closest('.tunnel-hud, .tunnel-tracks, .hud-sheet-wrap')) return;
    e.preventDefault(); // the wheel flies the camera; it must not also scroll the page
    target.current = Math.max(0, Math.min(maxCam, target.current + e.deltaY * 1.4));
    kick();
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => go(0), 160);
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const h = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  /* Vertical swipe / drag flies through the tunnel (the stage fits the screen, so it never fights a page scroll). */
  const drag = useRef<{ id: number; y: number; t0: number; last: number; at: number; v: number; moved: boolean } | null>(null);
  const tapGuard = useRef(false);
  const perPx = compact ? 3.2 : 4;
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, .tunnel-hud, .tunnel-tracks') || drag.current) return;
    drag.current = { id: e.pointerId, y: e.clientY, t0: target.current, last: e.clientY, at: performance.now(), v: 0, moved: false };
    tapGuard.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientY - d.y) > 8) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    const now = performance.now();
    if (now > d.at) d.v = 0.7 * ((d.last - e.clientY) / (now - d.at)) + 0.3 * d.v;
    d.last = e.clientY;
    d.at = now;
    target.current = Math.max(0, Math.min(maxCam, d.t0 + (d.y - e.clientY) * perPx));
    kick();
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    tapGuard.current = d.moved;
    // a flick keeps flying for a few cards
    if (d.moved && performance.now() - d.at < 90) target.current = Math.max(0, Math.min(maxCam, target.current + Math.max(-4, Math.min(4, d.v * 1.6)) * SPACING));
    go(0);
  };

  const current = items[focus];
  const len = (items.length + 4) * SPACING;
  const planeLen = Math.min(len, 5600);
  const closeSheet = useCallback(() => setSheet(false), []);

  return (
    <div
      className={`tunnel-stage ${warping ? 'warping' : ''} ${compact ? 'tunnel-stage--compact' : ''} ${landscapePhone ? 'tunnel-stage--land' : ''} ${calm ? 'fx-calm' : ''}`}
      ref={stage}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="tunnel-streaks" aria-hidden />
      <div className="tunnel-view" ref={view} style={{ '--card-w': `${cardW}px` } as React.CSSProperties}>
        <div className="tunnel-world" ref={world}>
          {/* corridor */}
          <div className="tunnel-corridor" ref={corridor}>
            <div className="tunnel-plane tunnel-floor" style={{ width: wallX * 2, height: planeLen, transform: `translate3d(${-wallX}px, ${H / 2}px, 0) rotateX(-90deg)` }} />
            <div className="tunnel-plane tunnel-ceil" style={{ width: wallX * 2, height: planeLen, transform: `translate3d(${-wallX}px, ${-H / 2}px, 0) rotateX(-90deg)` }} />
            <div className="tunnel-plane tunnel-wall" style={{ width: planeLen, height: H, transform: `translate3d(${-wallX}px, ${-H / 2}px, 0) rotateY(90deg)` }} />
            <div className="tunnel-plane tunnel-wall" style={{ width: planeLen, height: H, transform: `translate3d(${wallX}px, ${-H / 2}px, 0) rotateY(90deg)` }} />
          </div>
          {gates.map((g) => (
            <div key={g.label + g.z} className="tunnel-gate" style={{ width: wallX * 2, height: H, transform: `translate3d(${-wallX}px, ${-H / 2}px, ${g.z}px)` }}>
              <span>{g.label}</span>
            </div>
          ))}
          {items.map((it, i) => {
            const p = pos(i);
            return (
              <div
                key={it.show.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={`tunnel-item ${i === focus ? 'active' : ''}`}
                style={{ transform: `translate3d(${p.x}px, ${p.y}px, ${p.z}px) rotateY(${p.x < 0 ? 24 : -24}deg)` }}
                onClick={() => {
                  if (tapGuard.current) return; // the end of a swipe, not a tap
                  if (i === focus) {
                    remember(it.show);
                    nav(showPath(it.show.id));
                  } else {
                    target.current = i * SPACING;
                    kick();
                  }
                }}
              >
                <div className="tunnel-card">
                  <Poster show={it.show} />
                  {it.rec && <span className="ring-card__match">{it.rec.match}%</span>}
                </div>
                <div className="tunnel-caption">
                  <span className="mono">{String(i + 1).padStart(2, '0')}</span> {it.show.title}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <nav className="tunnel-tracks" aria-label="Tracks" ref={tracksNav}>
        {tracks.map((t) => (
          <button key={t.id} className={t.id === tid ? 'on' : ''} aria-pressed={t.id === tid} onClick={() => setTid(t.id)}>
            {compact ? t.label : (TRACK_LABEL[t.id] ?? t.label)}
            {compact && <span className="n">{t.items.length}</span>}
          </button>
        ))}
      </nav>

      <div className="tunnel-gauge" aria-hidden>
        <span className="mono">{String(focus + 1).padStart(2, '0')}</span>
        <div className="tunnel-gauge__track">
          <i style={{ height: `${items.length > 1 ? (focus / (items.length - 1)) * 100 : 0}%` }} />
        </div>
        <span className="mono">{String(items.length).padStart(2, '0')}</span>
      </div>

      <div className="tunnel-nav">
        <button className="btn btn--icon btn--sm" onClick={() => go(-1)} aria-label="Back" disabled={focus === 0}>
          <ChevronsUp size={16} />
        </button>
        {compact && (
          <span className="tunnel-nav__count mono" aria-live="polite">
            {String(focus + 1).padStart(2, '0')}/{String(items.length).padStart(2, '0')}
          </span>
        )}
        <button className="btn btn--icon btn--sm" onClick={() => go(1)} aria-label="Forward" disabled={focus >= items.length - 1}>
          <ChevronsDown size={16} />
        </button>
      </div>

      {current ? (
        <div className="tunnel-hud" key={current.show.id}>
          {compact ? <ShowHud item={current} side="compact" onMore={() => setSheet(true)} /> : <ShowHud item={current} />}
        </div>
      ) : (
        <div className="ring-empty">Nothing on this track yet.</div>
      )}
      {sheet && current && <HudSheet item={current} onClose={closeSheet} />}
    </div>
  );
}
