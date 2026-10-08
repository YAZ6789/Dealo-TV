import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { defaultCollection, useCollections, type CollectionId, type Item } from './useCollections';
import { HudSheet, ShowHud, useCalmFx, useCompact, useFitArtTitles } from './ShowHud';
import { Poster } from '../components/Poster';
import { prefetchArtwork } from '../providers/artwork';
import { remember, showPath } from '../lib/showCache';
import { cardOpacity, clampCam, easeCam, flingTarget, focusIndex, nearWindow, prefetchOrder, snapToward, SPACING, stepTarget } from './tunnelCamera';

/**
 * WARP TUNNEL — fly down a neon corridor. Posters line the walls; scroll,
 * swipe/drag or use ↑/↓ to travel. Your history track has glowing year gates;
 * the "For you" track gates every ten picks. The nearest show ahead is decoded
 * in the HUD below (a one-glance strip on phones, full readout on tap).
 *
 * The camera lives in refs and is written straight to the DOM; React only
 * re-renders when the focused card changes. The frame loop runs only while
 * the camera is moving.
 */

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

const placeOf = (i: number, lane: number) => ({ x: i % 2 === 0 ? -lane : lane, y: (i % 3) * 18 - 30, z: -i * SPACING - 260 });

export default function WarpTunnel() {
  const { collections } = useCollections();
  const nav = useNavigate();
  const compact = useCompact();
  const calm = useCalmFx();
  // Opens on your library until you pick a track yourself; a picked track that empties falls back.
  const [picked, setTid] = useState<CollectionId | null>(null);
  const tid = picked && collections.some((c) => c.id === picked && c.items.length) ? picked : defaultCollection(collections);
  // Same order as everywhere else: Watched → Watching → Watchlist → On hold, recommendations last.
  const tracks = collections.filter((c) => c.items.length);
  const items: Item[] = useMemo(() => {
    const c = collections.find((x) => x.id === tid);
    const list = (c?.items ?? []).slice(0, 60);
    if (tid === 'watched') return [...list].sort((a, b) => (b.entry?.completedAt ?? b.entry?.updatedAt ?? '').localeCompare(a.entry?.completedAt ?? a.entry?.updatedAt ?? ''));
    return list;
  }, [collections, tid]);
  const count = items.length;

  const [vw, setVw] = useState(() => innerWidth);
  const [vh, setVh] = useState(() => innerHeight);
  useEffect(() => {
    const h = () => {
      setVw(innerWidth);
      setVh(innerHeight);
    };
    addEventListener('resize', h);
    addEventListener('orientationchange', h);
    return () => {
      removeEventListener('resize', h);
      removeEventListener('orientationchange', h);
    };
  }, []);
  const landscapePhone = compact && vh < 520 && vw > vh;
  // Phones: cards sized to the room left between the track chips and the HUD strip.
  const cardW = compact ? Math.round(Math.max(84, Math.min(150, vw * 0.36, (vh - 330) / 2))) : Math.max(130, Math.min(230, vw * 0.15));
  const lane = compact ? Math.min((landscapePhone ? vw * 0.58 : vw) * 0.3, 260) : Math.min(vw * 0.3, 430);
  const wallX = lane + cardW * 0.9;
  const H = Math.min(vh * 0.95, 900);
  /** How far the camera leans towards the focused card (phones centre it more). */
  const lean = compact ? 0.62 : 0.35;

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

  /* ── camera (refs, so handlers and the frame loop never see stale values) ── */
  const world = useRef<HTMLDivElement>(null);
  const corridor = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tracksNav = useRef<HTMLElement>(null);
  const target = useRef(0);
  const cam = useRef(0);
  const raf = useRef(0);
  const live = useRef({ count, lane, lean, calm, items });
  live.current = { count, lane, lean, calm, items };
  const [focus, setFocusState] = useState(0);
  const focusRef = useRef(0);
  const [warping, setWarping] = useState(false);
  const [sheet, setSheet] = useState(false);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  /** Write the camera to the DOM (cheap; safe to call any time). */
  const apply = useCallback(() => {
    const { count: n, lane: ln, lean: le } = live.current;
    const z = cam.current;
    const f = focusIndex(z, n);
    if (world.current) world.current.style.transform = `translate3d(${-placeOf(f, ln).x * le}px, 0, ${z}px)`;
    // The corridor is a few screens long and hops forward with the camera, one grid cell at a time.
    if (corridor.current) corridor.current.style.transform = `translate3d(0, 0, ${-Math.floor(z / GRID) * GRID}px)`;
    for (let i = 0; i < n; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const o = cardOpacity(i, z);
      el.style.opacity = o.toFixed(3);
      el.style.visibility = o < 0.02 ? 'hidden' : '';
      el.style.pointerEvents = o < 0.2 ? 'none' : '';
    }
    if (f !== focusRef.current) {
      focusRef.current = f;
      setFocusState(f);
    }
  }, []);

  const step = useCallback(() => {
    raf.current = 0;
    const prev = cam.current;
    const s = easeCam(cam.current, target.current, live.current.calm ? 0.22 : 0.12);
    cam.current = s.cam;
    apply();
    setWarping(!live.current.calm && Math.abs(s.cam - prev) > 18);
    if (!s.settled) raf.current = requestAnimationFrame(step);
  }, [apply]);
  /** Make sure the loop is running (idempotent). */
  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(step);
  }, [step]);
  const setTarget = useCallback(
    (z: number) => {
      target.current = clampCam(z, live.current.count);
      kick();
    },
    [kick],
  );
  const go = useCallback((d: number) => setTarget(stepTarget(target.current, d, live.current.count)), [setTarget]);

  // Timers and the loop die with the component (leaving Home, StrictMode re-mounts).
  const snapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const vis = () => document.visibilityState === 'visible' && kick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      clearTimeout(snapTimer.current);
    };
  }, [kick]);

  // New track: start at the front, drop any gesture in progress.
  const drag = useRef<{ id: number; y: number; t0: number; last: number; at: number; v: number; moved: boolean } | null>(null);
  useLayoutEffect(() => {
    target.current = 0;
    cam.current = 0;
    drag.current = null;
    clearTimeout(snapTimer.current);
    setSheet(false);
    apply();
  }, [tid, apply]);
  // Same track, different length (a show moved lists): pull the camera back inside it.
  useLayoutEffect(() => {
    target.current = clampCam(target.current, count);
    cam.current = clampCam(cam.current, count);
    apply();
    kick();
  }, [count, apply, kick]);
  // Every render (new cards, resize, rotation): place things before paint so nothing flashes.
  useLayoutEffect(apply);

  /* ── pictures: the focused stretch loads eagerly, the next cards are pre-loaded ── */
  const lastFocus = useRef(0);
  const dir = useRef<1 | -1>(1);
  // A layout effect, so this runs before the cards' own (passive) artwork requests: the
  // lookup queue then serves the focused card first, then the way you're flying.
  useLayoutEffect(() => {
    if (focus !== lastFocus.current) dir.current = focus > lastFocus.current ? 1 : -1;
    lastFocus.current = focus;
    const list = live.current.items;
    if (!list.length) return;
    prefetchArtwork([focus, ...prefetchOrder(focus, dir.current, list.length)].filter((i) => list[i]).map((i) => list[i].show));
  }, [focus, items]);
  const near = nearWindow(focus, count);
  useFitArtTitles(view, [items, cardW, near.from, near.to]);

  // The readout follows the focus once it stops changing, so a fast flight doesn't rebuild it per card.
  const [hudIdx, setHudIdx] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setHudIdx(focus), raf.current ? 140 : 0);
    return () => clearTimeout(t);
  }, [focus]);

  // Keep the chosen track chip visible in the scrolling row (phones).
  useEffect(() => {
    const row = tracksNav.current;
    const on = row?.querySelector<HTMLElement>('button.on');
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2), behavior: calm ? 'auto' : 'smooth' });
  }, [tid, calm, tracks.length]);

  const openAt = useCallback(
    (i: number) => {
      const it = live.current.items[i];
      if (!it) return;
      remember(it.show);
      nav(showPath(it.show.id));
    },
    [nav],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [role="menu"], .menu') || document.querySelector('.overlay, .hud-sheet-wrap')) return;
      if (e.key === 'Enter' && t.closest('button, a')) return; // let focused controls handle Enter
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Home') setTarget(0);
      else if (e.key === 'End') setTarget(live.current.count * SPACING);
      else if (e.key === 'Enter') openAt(focusRef.current);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [go, setTarget, openAt]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.tunnel-hud, .tunnel-tracks, .hud-sheet-wrap') || e.ctrlKey) return;
      e.preventDefault(); // the wheel flies the camera; it must not also scroll the page
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
      if (!dy) return;
      setTarget(target.current + Math.max(-600, Math.min(600, dy * 1.4)));
      clearTimeout(snapTimer.current);
      const dirn = Math.sign(dy);
      snapTimer.current = setTimeout(() => setTarget(snapToward(target.current, dirn, live.current.count)), 160);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [setTarget, go]);

  /* Vertical swipe / drag flies through the tunnel (the stage fits the screen, so it never fights a page scroll). */
  const tapGuard = useRef(false);
  const perPx = compact ? 3.2 : 4;
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, .tunnel-hud, .tunnel-tracks')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A second finger joins the current drag's gesture; a new primary pointer replaces a drag whose "up" never arrived.
    if (drag.current && !e.isPrimary) return;
    clearTimeout(snapTimer.current);
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
    if (!d.moved) return;
    const now = performance.now();
    if (now > d.at) d.v = 0.7 * ((d.last - e.clientY) / (now - d.at)) + 0.3 * d.v;
    d.last = e.clientY;
    d.at = now;
    setTarget(d.t0 + (d.y - e.clientY) * perPx);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    tapGuard.current = d.moved;
    if (!d.moved) return;
    // a flick keeps flying for a few cards, then everything snaps to a card
    const quick = e.type === 'pointerup' && performance.now() - d.at < 90;
    const n = live.current.count;
    const pulled = d.y - d.last; // finger travel: up = forwards
    setTarget(quick ? flingTarget(target.current, d.v, n) : Math.abs(pulled) > 30 ? snapToward(target.current, Math.sign(pulled), n) : stepTarget(target.current, 0, n));
  };

  const pick = useCallback(
    (i: number) => {
      if (tapGuard.current) return; // the end of a swipe, not a tap
      if (i === focusRef.current) openAt(i);
      else setTarget(i * SPACING);
    },
    [openAt, setTarget],
  );

  const current = items[Math.min(hudIdx, count - 1)];
  const len = (count + 4) * SPACING;
  const lite = compact || calm;
  const planeLen = Math.min(len, lite ? 3600 : 5600);
  const closeSheet = useCallback(() => setSheet(false), []);

  return (
    <div
      className={`tunnel-stage ${warping ? 'warping' : ''} ${compact ? 'tunnel-stage--compact' : ''} ${landscapePhone ? 'tunnel-stage--land' : ''} ${calm ? 'fx-calm' : ''}`}
      ref={stage}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
    >
      <div className="tunnel-streaks" aria-hidden />
      {lite && <div className="tunnel-sides" aria-hidden />}
      <div className="tunnel-view" ref={view} style={{ '--card-w': `${cardW}px` } as React.CSSProperties}>
        <div className="tunnel-world" ref={world}>
          {/* corridor */}
          <div className="tunnel-corridor" ref={corridor}>
            <div className="tunnel-plane tunnel-floor" style={{ width: wallX * 2, height: planeLen, transform: `translate3d(${-wallX}px, ${H / 2}px, 0) rotateX(-90deg)` }} />
            {/* Walls and ceiling are huge 3D layers (most of the frame cost); phones and calm mode draw them flat instead (.tunnel-sides). */}
            {!lite && (
              <>
                <div className="tunnel-plane tunnel-ceil" style={{ width: wallX * 2, height: planeLen, transform: `translate3d(${-wallX}px, ${-H / 2}px, 0) rotateX(-90deg)` }} />
                <div className="tunnel-plane tunnel-wall" style={{ width: planeLen, height: H, transform: `translate3d(${-wallX}px, ${-H / 2}px, 0) rotateY(90deg)` }} />
                <div className="tunnel-plane tunnel-wall" style={{ width: planeLen, height: H, transform: `translate3d(${wallX}px, ${-H / 2}px, 0) rotateY(90deg)` }} />
              </>
            )}
          </div>
          {gates.map((g) => (
            <div key={g.label + g.z} className="tunnel-gate" style={{ width: wallX * 2, height: H, transform: `translate3d(${-wallX}px, ${-H / 2}px, ${g.z}px)` }}>
              <span>{g.label}</span>
            </div>
          ))}
          {items.map((it, i) => (
            <TunnelCard
              key={it.show.id}
              item={it}
              i={i}
              lane={lane}
              active={i === focus}
              near={i >= near.from && i <= near.to}
              onPick={pick}
              setRef={itemRefs}
            />
          ))}
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

      {count > 1 && (
        <div className="tunnel-gauge" aria-hidden>
          <span className="mono">{String(focus + 1).padStart(2, '0')}</span>
          <div className="tunnel-gauge__track">
            <i style={{ height: `${(focus / (count - 1)) * 100}%` }} />
          </div>
          <span className="mono">{String(count).padStart(2, '0')}</span>
        </div>
      )}

      {count > 1 && (
        <div className="tunnel-nav">
          <button className="btn btn--icon btn--sm" onClick={() => go(-1)} aria-label="Back" disabled={focus === 0}>
            <ChevronsUp size={16} />
          </button>
          {compact && (
            <span className="tunnel-nav__count mono">
              {String(focus + 1).padStart(2, '0')}/{String(count).padStart(2, '0')}
            </span>
          )}
          <button className="btn btn--icon btn--sm" onClick={() => go(1)} aria-label="Forward" disabled={focus >= count - 1}>
            <ChevronsDown size={16} />
          </button>
        </div>
      )}

      {current ? (
        <div className="tunnel-hud" key={current.show.id} aria-live="polite">
          {compact ? <ShowHud item={current} side="compact" onMore={() => setSheet(true)} /> : <ShowHud item={current} />}
        </div>
      ) : (
        <div className="ring-empty">{collections.some((c) => c.items.length) ? 'Nothing on this track yet.' : 'Add shows to your library to fly through them here.'}</div>
      )}
      {sheet && current && <HudSheet item={current} onClose={closeSheet} />}
    </div>
  );
}

/** One poster on the wall. Memoised: flying past only re-renders the cards whose focus or picture state changes. */
const TunnelCard = memo(function TunnelCard({
  item,
  i,
  lane,
  active,
  near,
  onPick,
  setRef,
}: {
  item: Item;
  i: number;
  lane: number;
  active: boolean;
  near: boolean;
  onPick: (i: number) => void;
  setRef: React.RefObject<(HTMLDivElement | null)[]>;
}) {
  const p = placeOf(i, lane);
  return (
    <div
      ref={(el) => {
        setRef.current[i] = el;
      }}
      className={`tunnel-item ${active ? 'active' : ''}`}
      style={{ transform: `translate3d(${p.x}px, ${p.y}px, ${p.z}px) rotateY(${p.x < 0 ? 24 : -24}deg)` }}
      onClick={() => onPick(i)}
    >
      <div className="tunnel-card">
        {/* Real pictures for the stretch you can see (eager: lazy-loading never fires inside 3D transforms); far cards stay blank and cheap. */}
        {near ? <Poster show={item.show} eager /> : <div className="tunnel-card__blank" />}
        {item.rec && <span className="ring-card__match">{item.rec.match}%</span>}
      </div>
      <div className="tunnel-caption">
        <span className="mono">{String(i + 1).padStart(2, '0')}</span> {item.show.title}
      </div>
    </div>
  );
});
