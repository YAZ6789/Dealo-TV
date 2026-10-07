import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useCollections, type CollectionId, type Item } from './useCollections';
import { ShowHud } from './ShowHud';
import { Poster } from '../components/Poster';
import { remember, showPath } from '../lib/showCache';
import { progressOf } from '../lib/progress';

/**
 * HOLO RING — a 3D carousel of posters standing on a holographic platform,
 * like a sci-fi film's computer console. Drag, scroll, arrow keys or click a
 * poster to spin; Enter opens the focused show. Collections sit on an arc dial.
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

export default function HoloRing() {
  const { collections, recs } = useCollections();
  const nav = useNavigate();
  const [cid, setCid] = useState<CollectionId>(() => (collections.find((c) => c.id === 'continue') ? 'continue' : 'foryou'));
  const col = collections.find((c) => c.id === cid) ?? collections[0];
  const items: Item[] = useMemo(() => (col?.items ?? []).slice(0, MAX_ITEMS), [col]);
  const n = items.length;
  const slots = Math.max(n, MIN_SLOTS);
  const step = 360 / slots;

  const vw = useViewport();
  // Card size from the viewport, shrunk if the ring would get wider than the stage.
  const maxR = Math.max(260, vw * (vw > 1100 ? 0.35 : 0.42));
  let cardW = Math.max(110, Math.min(200, vw * 0.15));
  if ((cardW / 2 / Math.tan(Math.PI / slots)) * 1.12 > maxR) cardW = Math.max(96, (2 * maxR * Math.tan(Math.PI / slots)) / 1.12);
  const radius = Math.round((cardW / 2 / Math.tan(Math.PI / slots)) * 1.12);

  const [rot, setRot] = useState(0); // degrees, continuous
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; rot: number; moved: boolean } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stage = useRef<HTMLDivElement>(null);

  const active = n ? ((Math.round(rot / step) % slots) + slots) % slots : 0;
  const activeIdx = active < n ? active : -1;
  const current = activeIdx >= 0 ? items[activeIdx] : undefined;

  // reset when switching collections
  useEffect(() => setRot(0), [cid]);

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
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || document.querySelector('.overlay')) return;
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

  const onWheel = (e: React.WheelEvent) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setDragging(true);
    setRot((r) => r + d * 0.12);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      setDragging(false);
      setRot((r) => {
        let idx = Math.round(r / step);
        const m = ((idx % slots) + slots) % slots;
        if (m >= n && n) idx += m - n < slots - m ? -(m - n + 1) : slots - m; // snap off empty slots
        return idx * step;
      });
    }, 140);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    drag.current = { x: e.clientX, rot, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    setRot(drag.current.rot - dx * (step / (cardW * 0.9)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    drag.current = null;
    setDragging(false);
    if (moved) {
      setRot((r) => Math.round(r / step) * step);
      return;
    }
    // a click: find the poster under the pointer
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-ring-i]');
    if (!el) return;
    const i = Number(el.dataset.ringI);
    if (i === activeIdx && current) {
      remember(current.show);
      nav(showPath(current.show.id));
    } else goTo(i);
  };

  return (
    <div className="ring-stage" ref={stage}>
      <nav className="ring-dial" aria-label="Collections">
        {collections.map((c, i) => {
          const off = i - (collections.length - 1) / 2;
          return (
            <button
              key={c.id}
              className={c.id === cid ? 'on' : ''}
              style={{ transform: `translateY(${off * off * 3.2}px) rotate(${off * 2.4}deg)` }}
              onClick={() => setCid(c.id)}
            >
              {c.label}
              <span className="n">{c.items.length}</span>
            </button>
          );
        })}
      </nav>

      <div className="ring-body">
        <aside className="ring-panel ring-panel--left" aria-live="polite">
          {current ? <ShowHud key={current.show.id} item={current} side="info" /> : null}
        </aside>

        <div
          className={`ring-viewport ${dragging ? 'dragging' : ''}`}
          style={{ '--card-w': `${cardW}px`, '--ring-r': `${radius}px` } as React.CSSProperties}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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
                          filter: `brightness(${Math.max(0.35, 1 - d / 140)})`,
                          '--i': i,
                        } as React.CSSProperties
                      }
                    >
                      <div className="ring-card">
                        <Poster show={it.show} />
                        {it.rec && <span className="ring-card__match">{it.rec.match}%</span>}
                        {p && p.total > 0 && (
                          <span className="ring-card__bar">
                            <span style={{ width: `${p.pct}%` }} />
                          </span>
                        )}
                      </div>
                      <div className="ring-reflect" aria-hidden>
                        <Poster show={it.show} />
                      </div>
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

        <aside className="ring-panel ring-panel--right">{current ? <ShowHud key={current.show.id} item={current} side="actions" /> : null}</aside>
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
    </div>
  );
}
