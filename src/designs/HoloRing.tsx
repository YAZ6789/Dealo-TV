import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { defaultCollection, useCollections, type CollectionId, type Item } from './useCollections';
import { HudSheet, ShowHud, useCalmFx, useCompact, useFitArtTitles } from './ShowHud';
import { Poster } from '../components/Poster';
import { prefetchArtwork } from '../providers/artwork';
import { remember, showPath } from '../lib/showCache';
import { progressOf } from '../lib/progress';

/**
 * HOLO RING — a 3D carousel of posters standing on a holographic platform,
 * like a sci-fi film's computer console. Drag, swipe, scroll, arrow keys or
 * click a poster to spin; Enter opens the focused show. Collections sit on an
 * arc dial (library first, recommendations last). On phones the readout folds
 * into a one-glance strip under the ring, with the full readout one tap away.
 */

const MAX_ITEMS = 20;
const MIN_SLOTS = 12;

function useViewport() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1280 : innerWidth));
  useEffect(() => {
    const h = () => setW(innerWidth);
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, []);
  return w;
}

/** Height of an element, kept live. */
function useHeight(ref: React.RefObject<HTMLElement | null>, fallback: number) {
  const [h, setH] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.clientHeight && setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

export default function HoloRing() {
  const { collections, recs } = useCollections();
  const nav = useNavigate();
  // Opens on your library (Watched → Watching → Watchlist) until you pick a list yourself.
  const [picked, setCid] = useState<CollectionId | null>(null);
  const cid = picked ?? defaultCollection(collections);
  const col = collections.find((c) => c.id === cid) ?? collections[0];
  const items: Item[] = useMemo(() => (col?.items ?? []).slice(0, MAX_ITEMS), [col]);
  const n = items.length;
  const slots = Math.max(n, MIN_SLOTS);
  const step = 360 / slots;

  const vw = useViewport();
  const compact = useCompact();
  const calm = useCalmFx();
  const viewport = useRef<HTMLDivElement>(null);
  const dial = useRef<HTMLElement>(null);
  const vh = useHeight(viewport, 480);
  const [sheet, setSheet] = useState(false);
  useFitArtTitles(viewport, [items, compact, vw, vh]);
  let cardW: number;
  if (compact) {
    // Phones: the front card is sized to the space left between the tabs and the strip;
    // the far side of the ring may run off the edges (it reads as "swipe for more").
    cardW = Math.round(Math.max(70, Math.min(170, vw * 0.36, (vh - 40) / 2)));
  } else {
    // Card size from the viewport, shrunk if the ring would get wider than the stage.
    const maxR = Math.max(260, vw * (vw > 1100 ? 0.35 : 0.42));
    cardW = Math.max(110, Math.min(200, vw * 0.15));
    if ((cardW / 2 / Math.tan(Math.PI / slots)) * 1.12 > maxR) cardW = Math.max(96, (2 * maxR * Math.tan(Math.PI / slots)) / 1.12);
  }
  const radius = Math.round((cardW / 2 / Math.tan(Math.PI / slots)) * 1.12);

  const [rot, setRot] = useState(0); // degrees, continuous
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; rot: number; moved: boolean; id: number; t: number; v: number; lx: number } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stage = useRef<HTMLDivElement>(null);

  const active = n ? ((Math.round(rot / step) % slots) + slots) % slots : 0;
  const activeIdx = active < n ? active : -1;

  // Pictures: the front card first, then its neighbours either side (layout effect, so this
  // order reaches the artwork queue before the cards' own requests).
  useLayoutEffect(() => {
    if (!n) return;
    const at = Math.max(0, activeIdx);
    const order = [0, 1, -1, 2, -2, 3, -3, 4, -4].map((k) => (((at + k) % n) + n) % n);
    prefetchArtwork([...new Set(order)].map((i) => items[i].show));
  }, [activeIdx, items, n]);
  const current = activeIdx >= 0 ? items[activeIdx] : undefined;

  // reset when switching collections
  useEffect(() => {
    setRot(0);
    setSheet(false);
  }, [cid]);

  // Keep the chosen tab visible in the scrolling tab row (phones).
  useEffect(() => {
    const nav = dial.current;
    const on = nav?.querySelector<HTMLElement>('button.on');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    const left = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: calm ? 'auto' : 'smooth' });
  }, [cid, calm, collections.length]);

  const goTo = useCallback(
    (i: number) => {
      // shortest rotation from current angle to slot i
      const cur = Math.round(rot / step);
      let delta = (((i - cur) % slots) + slots) % slots;
      if (delta > slots / 2) delta -= slots;
      setRot((cur + delta) * step);
    },
    [rot, step, slots],
  );
  const move = useCallback(
    (d: number) => {
      if (!n) return;
      const cur = Math.round(rot / step);
      // skip empty slots when the collection is smaller than the ring
      let next = cur + d;
      for (let k = 0; k < slots; k++) {
        const idx = ((next % slots) + slots) % slots;
        if (idx < n) break;
        next += d;
      }
      setRot(next * step);
    },
    [rot, step, slots, n],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [role="menu"], .menu') || document.querySelector('.overlay, .hud-sheet-wrap')) return;
      if (e.key === 'Enter' && t.closest('button, a')) return; // let focused controls handle Enter
      if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'Enter' && current) {
        remember(current.show);
        nav(showPath(current.show.id));
      } else return;
      e.preventDefault();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [move, current, nav]);

  /** Nearest slot that actually holds a show (the ring has empty slots when n < MIN_SLOTS). */
  const snap = (r: number) => {
    let idx = Math.round(r / step);
    const m = ((idx % slots) + slots) % slots;
    if (m >= n && n) idx += m - n < slots - m ? -(m - n + 1) : slots - m;
    return idx * step;
  };

  const onWheel = (e: React.WheelEvent) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setDragging(true);
    setRot((r) => r + d * 0.12);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      setDragging(false);
      setRot(snap);
    }, 140);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    if (drag.current) return; // second finger: ignore
    drag.current = { x: e.clientX, rot, moved: false, id: e.pointerId, t: performance.now(), v: 0, lx: e.clientX };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const degPerPx = step / (cardW * 0.9);
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    const now = performance.now();
    if (now > d.t) d.v = 0.7 * ((e.clientX - d.lx) / (now - d.t)) + 0.3 * d.v; // px per ms, smoothed
    d.t = now;
    d.lx = e.clientX;
    setRot(d.rot - dx * degPerPx);
  };
  /** Gesture taken over by the browser (e.g. a vertical page scroll): settle, never treat it as a tap. */
  const onPointerCancel = (e: React.PointerEvent) => {
    if (!drag.current || e.pointerId !== drag.current.id) return;
    drag.current = null;
    setDragging(false);
    setRot(snap);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    if (d.moved) {
      // a flick carries on for up to ~3 cards
      const fling = performance.now() - d.t < 80 ? Math.max(-3, Math.min(3, -d.v * 0.9)) * step : 0;
      setRot((r) => snap(r + fling));
      return;
    }
    // A tap: the front-most poster whose projected box holds the point. (3D hit-testing
    // misses the angled side cards, so this compares boxes and angles instead.)
    const angleFromFront = (i: number) => Math.abs(((((i * step - rot) % 360) + 540) % 360) - 180);
    let i = -1;
    for (const el of viewport.current?.querySelectorAll<HTMLElement>('[data-ring-i]') ?? []) {
      const r = el.querySelector('.ring-card')!.getBoundingClientRect();
      const k = Number(el.dataset.ringI);
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom || angleFromFront(k) > 100) continue;
      if (i < 0 || angleFromFront(k) < angleFromFront(i)) i = k;
    }
    if (i < 0) return;
    if (i === activeIdx && current) {
      remember(current.show);
      nav(showPath(current.show.id));
    } else goTo(i);
  };

  const closeSheet = useCallback(() => setSheet(false), []);

  return (
    <div className={`ring-stage ${compact ? 'ring-stage--compact' : ''} ${calm ? 'fx-calm' : ''}`} ref={stage}>
      <nav className="ring-dial" aria-label="Collections" ref={dial}>
        {collections.map((c, i) => {
          const off = i - (collections.length - 1) / 2;
          return (
            <button
              key={c.id}
              className={c.id === cid ? 'on' : ''}
              style={{ transform: `translateY(${off * off * 2.4}px) rotate(${off * 1.2}deg)` }}
              onClick={() => setCid(c.id)}
              aria-pressed={c.id === cid}
            >
              {c.label}
              <span className="n">{c.items.length}</span>
            </button>
          );
        })}
      </nav>

      <div className="ring-body">
        {!compact && (
          <aside className="ring-panel ring-panel--left" aria-live="polite">
            {current ? <ShowHud key={current.show.id} item={current} side="info" /> : null}
          </aside>
        )}

        <div
          ref={viewport}
          className={`ring-viewport ${dragging ? 'dragging' : ''}`}
          style={{ '--card-w': `${cardW}px`, '--ring-r': `${radius}px` } as React.CSSProperties}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          role="listbox"
          aria-label={col?.label}
          aria-activedescendant={current ? `ring-${activeIdx}` : undefined}
        >
          {n === 0 ? (
            <div className="ring-empty">
              {recs.stage !== 'ready' && cid === 'foryou' ? (
                <>
                  <div className="spinner" /> Computing your recommendations…
                </>
              ) : (
                <>
                  <Sparkles size={28} /> Nothing in “{col?.label}” yet.
                </>
              )}
            </div>
          ) : (
            <div className="ring-scene">
              <div className="ring-carousel" key={cid} style={{ transform: `translateZ(${-radius}px) rotateX(-7deg) rotateY(${-rot}deg)` }}>
                {items.map((it, i) => {
                  const ang = i * step;
                  let d = Math.abs((((ang - rot) % 360) + 540) % 360 - 180); // 0 = front
                  d = Math.min(d, 180);
                  const isActive = i === activeIdx;
                  const p = it.entry && it.entry.status === 'watching' ? progressOf(it.entry) : undefined;
                  return (
                    <div
                      key={it.show.id}
                      id={`ring-${i}`}
                      role="option"
                      aria-selected={isActive}
                      data-ring-i={i}
                      className={`ring-item ${isActive ? 'active' : ''}`}
                      style={
                        {
                          transform: `rotateY(${ang}deg) translateZ(${radius}px) ${isActive ? 'translateZ(90px) scale(1.16)' : ''}`,
                          opacity: Math.max(0.12, 1 - d / 165),
                          // a dimming overlay instead of filter: brightness() — filters re-rasterise 3D layers every frame
                          '--dim': Math.min(0.65, d / 140).toFixed(2),
                          '--i': i,
                        } as React.CSSProperties
                      }
                    >
                      <div className="ring-card">
                        {/* eager: lazy-loading never fires inside 3D transforms (and the ring holds at most 20) */}
                        <Poster show={it.show} eager={d < 100} />
                        {it.rec && <span className="ring-card__match">{it.rec.match}%</span>}
                        {p && p.total > 0 && (
                          <span className="ring-card__bar">
                            <span style={{ width: `${p.pct}%` }} />
                          </span>
                        )}
                      </div>
                      {(!calm || d < 60) && (
                        <div className="ring-reflect" aria-hidden>
                          <Poster show={it.show} eager={d < 100} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="ring-beam" aria-hidden />
              <div className="ring-floor" aria-hidden>
                <div className="ring-floor__disc" />
                <div className="ring-floor__ticks" />
                <div className="ring-floor__ring" />
              </div>
            </div>
          )}
        </div>

        {!compact && <aside className="ring-panel ring-panel--right">{current ? <ShowHud key={current.show.id} item={current} side="actions" /> : null}</aside>}
      </div>

      <div className="ring-ticker">
        <button className="btn btn--icon btn--sm" onClick={() => move(-1)} aria-label="Previous">
          <ChevronLeft size={16} />
        </button>
        <span className="mono">
          {col?.label.toUpperCase()} · {String(activeIdx + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
        </span>
        <button className="btn btn--icon btn--sm" onClick={() => move(1)} aria-label="Next">
          <ChevronRight size={16} />
        </button>
        <span className="ring-hint">drag · scroll · ← → · enter</span>
      </div>

      {compact && current && (
        <div className="ring-strip" aria-live="polite">
          <ShowHud key={current.show.id} item={current} side="compact" onMore={() => setSheet(true)} />
        </div>
      )}
      {sheet && current && <HudSheet item={current} onClose={closeSheet} />}
    </div>
  );
}
