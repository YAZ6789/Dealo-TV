import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { useCollections, type CollectionId, type Item } from './useCollections';
import { ShowHud } from './ShowHud';
import { Poster } from '../components/Poster';
import { remember, showPath } from '../lib/showCache';

/**
 * WARP TUNNEL — fly down a neon corridor. Posters line the walls; scroll,
 * drag or use ↑/↓ to travel. Your history track has glowing year gates; the
 * "For you" track gates every ten picks. The nearest show ahead is decoded in
 * the HUD below.
 */

const SPACING = 440;
const TRACKS: { id: CollectionId; label: string }[] = [
  { id: 'foryou', label: 'Into the future · For you' },
  { id: 'watched', label: 'Into the past · Your history' },
  { id: 'continue', label: 'In progress' },
  { id: 'watchlist', label: 'Watchlist' },
];

interface Gate {
  z: number;
  label: string;
}

export default function WarpTunnel() {
  const { collections } = useCollections();
  const nav = useNavigate();
  const [tid, setTid] = useState<CollectionId>('foryou');
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
  const cardW = Math.max(130, Math.min(230, vw * 0.15));
  const lane = Math.min(vw * 0.3, 430);
  const wallX = lane + cardW * 0.9;
  const H = Math.min(vh * 0.95, 900);

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
  const target = useRef(0);
  const cam = useRef(0);
  const [focus, setFocus] = useState(0);
  const [warping, setWarping] = useState(false);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const maxCam = Math.max(0, (items.length - 1) * SPACING);

  useEffect(() => {
    target.current = 0;
    cam.current = 0;
    setFocus(0);
  }, [tid]);

  useEffect(() => {
    let raf = 0;
    let lastFocus = -1;
    let lastWarp = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const prev = cam.current;
      cam.current += (target.current - cam.current) * 0.1;
      if (Math.abs(target.current - cam.current) < 0.3) cam.current = target.current;
      const v = Math.abs(cam.current - prev);
      const f = Math.max(0, Math.min(items.length - 1, Math.round(cam.current / SPACING)));
      const fp = pos(f);
      if (world.current) world.current.style.transform = `translate3d(${-fp.x * 0.35}px, 0, ${cam.current}px)`;
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        const z = -i * SPACING - 260 + cam.current;
        const o = z > 200 ? 0 : z > -200 ? 1 : Math.max(0, 1 + (z + 200) / 3600);
        el.style.opacity = String(o);
        el.style.pointerEvents = o < 0.2 ? 'none' : 'auto';
      });
      if (f !== lastFocus) {
        lastFocus = f;
        setFocus(f);
      }
      const w = v > 18;
      if (w !== lastWarp) {
        lastWarp = w;
        setWarping(w);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, lane]);

  const go = (d: number) => {
    target.current = Math.max(0, Math.min(maxCam, Math.round(target.current / SPACING + d) * SPACING));
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || document.querySelector('.overlay')) return;
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
  const onWheel = (e: React.WheelEvent) => {
    target.current = Math.max(0, Math.min(maxCam, target.current + e.deltaY * 1.4));
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => go(0), 160);
  };
  const drag = useRef<{ y: number; t: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    drag.current = { y: e.clientY, t: target.current };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    target.current = Math.max(0, Math.min(maxCam, drag.current.t + (drag.current.y - e.clientY) * 4));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    go(0);
  };

  const current = items[focus];
  const len = (items.length + 4) * SPACING;

  return (
    <div className={`tunnel-stage ${warping ? 'warping' : ''}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="tunnel-streaks" aria-hidden />
      <div className="tunnel-view" style={{ '--card-w': `${cardW}px` } as React.CSSProperties}>
        <div className="tunnel-world" ref={world}>
          {/* corridor */}
          <div className="tunnel-plane tunnel-floor" style={{ width: wallX * 2, height: len, transform: `translate3d(${-wallX}px, ${H / 2}px, 0) rotateX(-90deg)` }} />
          <div className="tunnel-plane tunnel-ceil" style={{ width: wallX * 2, height: len, transform: `translate3d(${-wallX}px, ${-H / 2}px, 0) rotateX(-90deg)` }} />
          <div className="tunnel-plane tunnel-wall" style={{ width: len, height: H, transform: `translate3d(${-wallX}px, ${-H / 2}px, 0) rotateY(90deg)` }} />
          <div className="tunnel-plane tunnel-wall" style={{ width: len, height: H, transform: `translate3d(${wallX}px, ${-H / 2}px, 0) rotateY(90deg)` }} />
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
                  if (i === focus) {
                    remember(it.show);
                    nav(showPath(it.show.id));
                  } else target.current = i * SPACING;
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

      <nav className="tunnel-tracks" aria-label="Tracks">
        {TRACKS.filter((t) => collections.some((c) => c.id === t.id && c.items.length)).map((t) => (
          <button key={t.id} className={t.id === tid ? 'on' : ''} onClick={() => setTid(t.id)}>
            {t.label}
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
        <button className="btn btn--icon btn--sm" onClick={() => go(-1)} aria-label="Back">
          <ChevronsUp size={16} />
        </button>
        <button className="btn btn--icon btn--sm" onClick={() => go(1)} aria-label="Forward">
          <ChevronsDown size={16} />
        </button>
      </div>

      {current ? (
        <div className="tunnel-hud" key={current.show.id}>
          <ShowHud item={current} />
        </div>
      ) : (
        <div className="ring-empty">Nothing on this track yet.</div>
      )}
    </div>
  );
}
