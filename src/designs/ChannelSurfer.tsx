import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CornerDownLeft, ListVideo, Sparkles, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { defaultCollection, useCollections, type Collection, type CollectionId, type Item } from './useCollections';
import { ShowHud } from './ShowHud';
import { Poster } from '../components/Poster';
import { remember, showPath } from '../lib/showCache';
import { fmtEp, progressOf } from '../lib/progress';
import { STATUS_LABEL, yearRange } from '../lib/labels';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';

/**
 * CHANNEL SURFER — flip through your shows on a retro TV set.
 * Every show is a channel (1…n); collections are "networks" (inputs).
 * ↑/↓ · CH± · wheel · swipe change channel (static burst), ←/→ switch network
 * (picture collapses to a line, like changing inputs), digits tune directly,
 * G opens the programme guide, Enter / OK opens the show.
 */

interface Channel {
  no: number;
  cid: CollectionId;
  net: string;
  netIdx: number;
  idx: number;
  item: Item;
}
type Fx = 'static' | 'input' | 'fade';
interface Osd {
  id: number;
  kind: 'ch' | 'input' | 'nochan';
  text: string;
  sub?: string;
}

const keyOf = (c: Channel) => `${c.cid}:${c.item.show.id}`;

function useReducedMotion() {
  const reduceFx = useSettings((s) => s.reduceFx);
  const [pref, setPref] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setPref(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return pref || reduceFx;
}

/** TV static: a tiny canvas of random grey pixels, scaled up, redrawn every frame while active. */
function Noise({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!active || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(cv.width, cv.height);
    const px = new Uint32Array(img.data.buffer);
    let raf = 0;
    const draw = () => {
      const w = cv.width;
      for (let y = 0; y < cv.height; y++) {
        // each row gets its own brightness → horizontal tearing bands
        const band = Math.random() < 0.06 ? 90 : 0;
        for (let x = 0; x < w; x++) {
          const v = Math.min(255, ((Math.random() * 255) | 0) + band);
          px[y * w + x] = (255 << 24) | (v << 16) | (v << 8) | v;
        }
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} className={`ch-noise ${active ? 'on' : ''}`} width={160} height={120} aria-hidden />;
}

/** One-line "what's on" for a channel: progress for library shows, match for recommendations. */
function nowLine(it: Item, entry = it.entry) {
  if (entry) {
    const p = progressOf(entry);
    if (entry.status === 'watching') return { tag: 'Now', text: p.next ? fmtEp(p.next) : 'Caught up', pct: p.total ? p.pct : undefined, detail: p.total ? `${p.watched}/${p.total} eps` : undefined };
    if (entry.status === 'plan') return { tag: 'Premiere', text: 'S1·E01', detail: 'On your watchlist' };
    if (entry.status === 'completed') return { tag: 'Rerun', text: entry.rating != null ? `★ ${entry.rating}/10` : '', detail: p.total ? `All ${p.total} eps watched` : 'Watched' };
    if (entry.status === 'on_hold') return { tag: 'Paused', text: p.next ? fmtEp(p.next) : STATUS_LABEL.on_hold, pct: p.total ? p.pct : undefined };
    return { tag: STATUS_LABEL[entry.status], text: '' };
  }
  if (it.rec) return { tag: 'Match', text: `${it.rec.match}%`, pct: it.rec.match, detail: it.rec.exploratory ? 'Outside your usual' : it.rec.reasons.find((r) => r.kind === 'because')?.label };
  return { tag: 'On air', text: '' };
}

export default function ChannelSurfer() {
  const { collections, recs } = useCollections();
  const entries = useLibrary((s) => s.entries);
  const nav = useNavigate();
  const reduced = useReducedMotion();

  const channels = useMemo(() => {
    const out: Channel[] = [];
    collections.forEach((c, netIdx) => c.items.forEach((item, idx) => out.push({ no: out.length + 1, cid: c.id, net: c.label, netIdx, idx, item })));
    return out;
  }, [collections]);
  const pad = Math.max(2, String(channels.length).length);
  const fmtCh = (n: number) => String(n).padStart(pad, '0');

  // ── what's tuned ── (until the viewer tunes, follow the library-first default; the library hydrates async)
  const [tuned, setTuned] = useState<{ cid?: CollectionId; showId?: string; idx: number }>({ idx: 0 });
  const cid: CollectionId = tuned.cid ?? defaultCollection(collections);

  const netIdx = Math.max(0, collections.findIndex((c) => c.id === cid));
  const net: Collection | undefined = collections[netIdx];
  const current = useMemo(() => {
    const inNet = channels.filter((c) => c.cid === cid);
    if (!inNet.length) return undefined;
    return inNet.find((c) => c.item.show.id === tuned.showId) ?? inNet[Math.min(tuned.idx, inNet.length - 1)];
  }, [channels, tuned, cid]);
  const curKey = current ? keyOf(current) : `empty:${cid}`;

  const lastPerNet = useRef<Partial<Record<CollectionId, string>>>({});
  const prevKey = useRef<string | undefined>(undefined);
  const pendingFx = useRef<Fx>('fade');
  const pendingOsd = useRef<Omit<Osd, 'id'> | undefined>(undefined);
  const osdSeq = useRef(0);
  const [osd, setOsd] = useState<Osd | undefined>();

  const tune = useCallback(
    (ch: Channel, kind: Fx = 'static') => {
      if (current && keyOf(current) === keyOf(ch)) {
        setOsd({ id: ++osdSeq.current, kind: 'ch', text: `CH ${fmtCh(ch.no)}`, sub: ch.net });
        return;
      }
      if (current) prevKey.current = keyOf(current);
      lastPerNet.current[ch.cid] = ch.item.show.id;
      pendingFx.current = kind;
      pendingOsd.current = kind === 'input' ? { kind: 'input', text: `INPUT: ${ch.net.toUpperCase()}`, sub: `CH ${fmtCh(ch.no)}` } : { kind: 'ch', text: `CH ${fmtCh(ch.no)}`, sub: ch.net };
      setTuned({ cid: ch.cid, showId: ch.item.show.id, idx: ch.idx });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, pad],
  );

  const step = useCallback(
    (d: number) => {
      if (!channels.length) return;
      const n = channels.length;
      const base = current ? current.no - 1 : d > 0 ? -1 : 0;
      tune(channels[(((base + d) % n) + n) % n], 'static');
    },
    [channels, current, tune],
  );

  const tuneNet = useCallback(
    (i: number) => {
      const c = collections[i];
      if (!c || c.id === cid) return;
      const inNet = channels.filter((ch) => ch.cid === c.id);
      const target = inNet.find((ch) => ch.item.show.id === lastPerNet.current[c.id]) ?? inNet[0];
      if (target) return tune(target, 'input');
      if (current) prevKey.current = keyOf(current);
      pendingFx.current = 'input';
      pendingOsd.current = { kind: 'input', text: `INPUT: ${c.label.toUpperCase()}`, sub: 'No signal' };
      setTuned({ cid: c.id, idx: 0 });
    },
    [collections, channels, cid, current, tune],
  );
  const netStep = useCallback(
    (d: number) => {
      const n = collections.length;
      if (n < 2) return;
      tuneNet((((netIdx + d) % n) + n) % n);
    },
    [collections.length, netIdx, tuneNet],
  );

  const recall = useCallback(() => {
    const ch = channels.find((c) => keyOf(c) === prevKey.current);
    if (ch) tune(ch, 'static');
  }, [channels, tune]);

  const open = useCallback(() => {
    if (!current) return;
    remember(current.item.show);
    nav(showPath(current.item.show.id));
  }, [current, nav]);

  // ── sound (off by default, created only after the viewer turns it on) ──
  const audio = useRef<AudioContext | null>(null);
  const [sound, setSound] = useState(false);
  const toggleSound = () => {
    if (!sound) {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        return;
      }
    }
    setSound(!sound);
  };
  useEffect(() => () => void audio.current?.close(), []);
  const hiss = useCallback(
    (dur: number) => {
      const ctx = audio.current;
      if (!sound || !ctx) return;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.setValueAtTime(0.05, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(hp).connect(g).connect(ctx.destination);
      src.start();
    },
    [sound],
  );

  // ── the transition: picture lags behind the tuned channel while the effect plays ──
  const [pic, setPic] = useState(curKey);
  const picRef = useRef(curKey);
  const [prevPic, setPrevPic] = useState<string | undefined>();
  const [fx, setFx] = useState<{ kind: Fx; id: number } | null>(null);
  const fxSeq = useRef(0);
  const swapT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const endT = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (curKey === picRef.current) return;
    let kind = pendingFx.current;
    pendingFx.current = 'fade';
    if (reduced) kind = 'fade';
    const nextOsd = pendingOsd.current;
    pendingOsd.current = undefined;
    setFx({ kind, id: ++fxSeq.current });
    if (kind !== 'fade') hiss(kind === 'input' ? 0.32 : 0.26);
    const swap = () => {
      if (kind === 'fade') setPrevPic(picRef.current);
      picRef.current = curKey;
      setPic(curKey);
      if (nextOsd) setOsd({ ...nextOsd, id: ++osdSeq.current });
    };
    clearTimeout(swapT.current);
    clearTimeout(endT.current);
    const swapAt = kind === 'input' ? 250 : kind === 'static' ? 120 : 0;
    if (swapAt) swapT.current = setTimeout(swap, swapAt);
    else swap();
    endT.current = setTimeout(
      () => {
        setFx(null);
        setPrevPic(undefined);
      },
      kind === 'input' ? 640 : kind === 'static' ? 330 : 320,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);
  useEffect(
    () => () => {
      clearTimeout(swapT.current);
      clearTimeout(endT.current);
    },
    [],
  );

  const byKey = (k?: string) => (k ? channels.find((c) => keyOf(c) === k) : undefined);
  const shown = pic === curKey ? current : byKey(pic);
  const shownPrev = byKey(prevPic);
  const phase = fx && pic !== curKey ? 'out' : fx ? 'in' : 'idle';

  // ── number keys like a remote ──
  const [digits, setDigits] = useState('');
  const maxDigits = Math.max(1, String(channels.length).length);
  const commitDigits = useCallback(
    (ds: string) => {
      setDigits('');
      if (!ds) return;
      const no = parseInt(ds, 10);
      const ch = channels[no - 1];
      if (ch) tune(ch, 'static');
      else setOsd({ id: ++osdSeq.current, kind: 'nochan', text: `CH ${String(no).padStart(pad, '0')}`, sub: 'No channel' });
    },
    [channels, tune, pad],
  );
  const pressDigit = useCallback(
    (d: string) => {
      const next = (digits + d).replace(/^0+(?=\d)/, '');
      if (next.length >= maxDigits) commitDigits(next);
      else setDigits(next);
    },
    [digits, maxDigits, commitDigits],
  );
  useEffect(() => {
    if (!digits) return;
    const t = setTimeout(() => commitDigits(digits), 1000);
    return () => clearTimeout(t);
  }, [digits, commitDigits]);

  // ── guide ──
  const [guide, setGuide] = useState(false);
  const [guideNet, setGuideNet] = useState(netIdx);
  const [guideSel, setGuideSel] = useState(0);
  const guideBtn = useRef<HTMLButtonElement>(null);
  const guideList = useRef<HTMLDivElement>(null);
  const guideChannels = useMemo(() => channels.filter((c) => c.netIdx === guideNet), [channels, guideNet]);
  const openGuide = useCallback(() => {
    setGuideNet(netIdx);
    setGuideSel(current ? current.idx : 0);
    setGuide(true);
  }, [netIdx, current]);
  const closeGuide = useCallback(() => {
    setGuide(false);
    requestAnimationFrame(() => guideBtn.current?.focus());
  }, []);
  useEffect(() => {
    if (!guide) return;
    const el = guideList.current?.querySelector<HTMLElement>(`[data-gi="${guideSel}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  }, [guide, guideSel, guideNet]);
  const guideNetStep = (d: number) => {
    const n = collections.length;
    setGuideNet((g) => (((g + d) % n) + n) % n);
    setGuideSel(0);
  };

  // ── keyboard ──
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"], .menu') || document.querySelector('.overlay')) return;
      const key = e.key;
      if (guide) {
        if (key === 'Tab') {
          // keep focus inside the guide dialog
          const panel = document.querySelector<HTMLElement>('.ch-guide__panel');
          const focusables = panel ? [...panel.querySelectorAll<HTMLElement>('button:not([disabled])')].filter((b) => b.tabIndex >= 0) : [];
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const inside = panel?.contains(document.activeElement);
          if (e.shiftKey && (document.activeElement === first || !inside)) last.focus();
          else if (!e.shiftKey && (document.activeElement === last || !inside)) first.focus();
          else return;
        } else if (key === 'Escape' || key === 'g' || key === 'G') closeGuide();
        else if (key === 'ArrowDown') setGuideSel((s) => Math.min(guideChannels.length - 1, s + 1));
        else if (key === 'ArrowUp') setGuideSel((s) => Math.max(0, s - 1));
        else if (key === 'PageDown') setGuideSel((s) => Math.min(guideChannels.length - 1, s + 8));
        else if (key === 'PageUp') setGuideSel((s) => Math.max(0, s - 8));
        else if (key === 'ArrowRight') guideNetStep(1);
        else if (key === 'ArrowLeft') guideNetStep(-1);
        else if (key === 'Enter' && !t.closest('[data-gi]') && guideChannels[guideSel]) {
          tune(guideChannels[guideSel]);
          closeGuide();
        } else return;
        e.preventDefault();
        return;
      }
      if (/^[0-9]$/.test(key)) pressDigit(key);
      else if (key === 'ArrowUp' || key === 'PageUp') step(1);
      else if (key === 'ArrowDown' || key === 'PageDown') step(-1);
      else if (key === 'ArrowRight') netStep(1);
      else if (key === 'ArrowLeft') netStep(-1);
      else if (key === 'g' || key === 'G') openGuide();
      else if (key === 'm' || key === 'M') toggleSound();
      else if (key === 'Backspace') {
        if (digits) setDigits(digits.slice(0, -1));
        else recall();
      } else if (key === 'Escape' && digits) setDigits('');
      else if (key === 'Enter') {
        if (digits) commitDigits(digits);
        else if (t.closest('button, a, [tabindex]')) return; // focused controls handle Enter themselves
        else open();
      } else return;
      e.preventDefault();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  // ── wheel + swipe on the screen ──
  const screen = useRef<HTMLDivElement>(null);
  const wheel = useRef({ acc: 0, at: 0 });
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const w = (e: WheelEvent) => {
      e.preventDefault();
      const s = wheel.current;
      s.acc += e.deltaY;
      const now = performance.now();
      if (Math.abs(s.acc) > 50 && now - s.at > 180) {
        stepRef.current(s.acc > 0 ? 1 : -1);
        s.acc = 0;
        s.at = now;
      }
    };
    el.addEventListener('wheel', w, { passive: false });
    return () => el.removeEventListener('wheel', w);
  }, []);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) step(dy < 0 ? 1 : -1);
    else if (Math.abs(dx) > 60) netStep(dx < 0 ? 1 : -1);
  };

  const curEntry = current ? entries[current.item.show.id] ?? current.item.entry : undefined;
  const item = current ? { ...current.item, entry: curEntry } : undefined;
  const status = recs.stage !== 'ready' && cid === 'foryou' ? 'tuning' : 'empty';

  const renderPicture = (ch: Channel | undefined, cls: string) =>
    ch ? (
      <div key={keyOf(ch)} className={`ch-pic ${cls}`}>
        <Poster show={ch.item.show} variant="hero" eager />
      </div>
    ) : (
      <div key="bars" className={`ch-pic ch-pic--bars ${cls}`} aria-hidden>
        <div className="ch-bars" />
      </div>
    );

  return (
    <div className={`ch-stage ${reduced ? 'ch-reduced' : ''}`}>
      <nav className="ch-nets" aria-label="Networks">
        <span className="label ch-nets__label">Input</span>
        <div className="ch-nets__list">
          {collections.map((c, i) => (
            <button key={c.id} className={`ch-net ${i === netIdx ? 'on' : ''}`} aria-pressed={i === netIdx} onClick={() => tuneNet(i)}>
              {c.label}
              <span className="ch-net__n">{c.items.length}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="ch-main">
        <div className="ch-tvwrap">
          <div className={`ch-tv ${fx ? 'is-fx' : ''}`}>
            <div className="ch-ant" aria-hidden>
              <span className="ch-ant__rod ch-ant__rod--l" />
              <span className="ch-ant__rod ch-ant__rod--r" />
              <span className="ch-ant__base" />
            </div>
            <div className="ch-tv__body">
              <div className="ch-tv__mask">
                <div
                  ref={screen}
                  className={`ch-screen ch-screen--${phase} ${fx ? `fx-${fx.kind}` : ''}`}
                  onPointerDown={onPointerDown}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => (swipe.current = null)}
                  role="region"
                  aria-roledescription="TV screen"
                  aria-label={shown ? `Channel ${shown.no}, ${shown.net}: ${shown.item.show.title}` : 'No signal'}
                >
                  <div className="ch-picwrap">
                    {shownPrev && fx?.kind === 'fade' && renderPicture(shownPrev, 'ch-pic--prev')}
                    {renderPicture(shown, phase === 'out' && fx ? `ch-pic--out-${fx.kind}` : phase === 'in' && fx ? `ch-pic--in-${fx.kind}` : '')}
                  </div>
                  <div className="ch-scan" aria-hidden />
                  <div className="ch-flicker" aria-hidden />
                  {!reduced && <Noise active={fx?.kind === 'static'} />}
                  <div className="ch-line" aria-hidden />
                  <div className="ch-vignette" aria-hidden />

                  {/* broadcast graphics, all on solid plates */}
                  <div className="ch-bug">
                    <span className="ch-bug__dot" aria-hidden />
                    {net?.label ?? 'No input'}
                  </div>

                  {digits ? (
                    <div className="ch-osd ch-osd--typing" aria-live="assertive">
                      <span className="ch-osd__big">
                        CH {digits}
                        <span className="ch-osd__blank">{'–'.repeat(Math.max(0, maxDigits - digits.length))}</span>
                      </span>
                    </div>
                  ) : osd ? (
                    <div key={osd.id} className={`ch-osd ch-osd--${osd.kind}`} aria-live="polite">
                      <span className="ch-osd__big">{osd.text}</span>
                      {osd.sub && <span className="ch-osd__sub">{osd.sub}</span>}
                    </div>
                  ) : null}

                  {shown ? (
                    <LowerThird key={keyOf(shown)} ch={shown} fmtCh={fmtCh} />
                  ) : (
                    <div className="ch-nosignal">
                      {status === 'tuning' ? (
                        <>
                          <div className="spinner" /> Tuning in — computing your recommendations…
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} /> No signal · nothing in “{net?.label ?? 'this input'}” yet
                        </>
                      )}
                    </div>
                  )}
                  <div className="ch-glass" aria-hidden />
                </div>
              </div>

              <div className="ch-tv__side">
                <div className="ch-brand">
                  <span className="ch-brand__name">Dealo</span>
                  <span className="ch-brand__model">CS-{String(channels.length).padStart(3, '0')}</span>
                </div>
                <div className="ch-lcd" aria-hidden>
                  {digits ? digits.padEnd(maxDigits, '-') : current ? fmtCh(current.no) : '--'}
                </div>
                <div className="ch-knobs">
                  <button className="ch-knob" onClick={() => step(1)} aria-label="Channel up" title="Channel up (↑)">
                    <span className="ch-knob__cap" style={{ '--rot': `${(current?.no ?? 0) * 30}deg` } as CSSProperties} />
                    <span className="ch-knob__lbl">Channel</span>
                  </button>
                  <button className="ch-knob" onClick={() => netStep(1)} aria-label="Next network" title="Next network (→)">
                    <span className="ch-knob__cap" style={{ '--rot': `${netIdx * 52}deg` } as CSSProperties} />
                    <span className="ch-knob__lbl">Input</span>
                  </button>
                </div>
                <div className="ch-tvbtns">
                  <button ref={guideBtn} className="ch-tvbtn" onClick={openGuide} aria-haspopup="dialog" aria-label="Programme guide" title="Programme guide (G)">
                    <ListVideo size={15} /> <span>Guide</span>
                  </button>
                  <button className={`ch-tvbtn ${sound ? 'on' : ''}`} onClick={toggleSound} aria-pressed={sound} aria-label="Static sound" title="Static sound (M)">
                    {sound ? <Volume2 size={15} /> : <VolumeX size={15} />} <span>{sound ? 'Sound on' : 'Muted'}</span>
                  </button>
                </div>
                <div className="ch-grill" aria-hidden />
                <div className="ch-power">
                  <span className={`ch-led ${fx ? 'blink' : ''}`} aria-hidden />
                  <span className="ch-power__lbl">Power</span>
                </div>
              </div>
            </div>
            <div className="ch-tv__feet" aria-hidden>
              <span />
              <span />
            </div>
          </div>
        </div>

        <aside className="ch-side">
          <section className="ch-remote" aria-label="Remote control">
            <div className="ch-remote__top">
              <span className="ch-remote__ir" aria-hidden />
              <span className="ch-remote__brand">Remote</span>
              <button className="ch-rbtn ch-rbtn--wide" onClick={openGuide} title="Programme guide (G)">
                <ListVideo size={15} /> Guide
              </button>
              <button className={`ch-rbtn ${sound ? 'on' : ''}`} onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Mute static sound' : 'Turn on static sound'} title="Static sound (M)">
                {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
            </div>
            <div className="ch-remote__body">
              <div className="ch-dpad">
                <button className="ch-dpad__b ch-dpad__up" onClick={() => step(1)} aria-label="Channel up">
                  <ChevronUp size={16} />
                  <span>CH +</span>
                </button>
                <button className="ch-dpad__b ch-dpad__left" onClick={() => netStep(-1)} aria-label="Previous network">
                  <ChevronLeft size={16} />
                  <span>NET</span>
                </button>
                <button className="ch-dpad__ok" onClick={open} disabled={!current} aria-label="OK — open show page">
                  OK
                </button>
                <button className="ch-dpad__b ch-dpad__right" onClick={() => netStep(1)} aria-label="Next network">
                  <span>NET</span>
                  <ChevronRight size={16} />
                </button>
                <button className="ch-dpad__b ch-dpad__down" onClick={() => step(-1)} aria-label="Channel down">
                  <span>CH −</span>
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="ch-keys" role="group" aria-label="Channel number">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button key={d} className="ch-key" onClick={() => pressDigit(d)}>
                    {d}
                  </button>
                ))}
                <button className="ch-key ch-key--fn" onClick={recall} disabled={!prevKey.current} aria-label="Last channel" title="Last channel (Backspace)">
                  <Undo2 size={14} />
                  <span>Last</span>
                </button>
                <button className="ch-key" onClick={() => pressDigit('0')}>
                  0
                </button>
                <button className="ch-key ch-key--fn" onClick={() => (digits ? commitDigits(digits) : open())} aria-label={digits ? 'Tune to typed channel' : 'Enter — open show page'}>
                  <CornerDownLeft size={14} />
                  <span>Enter</span>
                </button>
              </div>
            </div>
            <p className="ch-remote__hint">
              <kbd>↑</kbd>
              <kbd>↓</kbd> channel · <kbd>←</kbd>
              <kbd>→</kbd> network · <kbd>0–9</kbd> tune · <kbd>G</kbd> guide · <kbd>Enter</kbd> open
            </p>
          </section>

          {item && current ? (
            <section className="ch-now" aria-live="polite">
              <div className="ch-now__eyebrow">
                On CH {fmtCh(current.no)} · {current.net}
              </div>
              <h2 className="ch-now__title">{item.show.title}</h2>
              {item.show.overview && <p className="ch-now__overview">{item.show.overview}</p>}
              <ShowHud key={item.show.id} item={item} side="actions" />
            </section>
          ) : (
            <section className="ch-now ch-now--empty">
              <p className="hint">Nothing is on this input. Try another network with ← →.</p>
            </section>
          )}
        </aside>
      </div>

      {guide && (
        <div className="ch-guide" onMouseDown={(e) => e.target === e.currentTarget && closeGuide()}>
          <div className="ch-guide__panel" role="dialog" aria-modal="true" aria-labelledby="ch-guide-title">
            <header className="ch-guide__head">
              <h2 id="ch-guide-title" className="ch-guide__title">
                <ListVideo size={18} /> Guide
              </h2>
              <div className="ch-guide__nets">
                <button className="btn btn--sm btn--icon" onClick={() => guideNetStep(-1)} aria-label="Previous network">
                  <ChevronLeft size={16} />
                </button>
                <span className="ch-guide__net">
                  {collections[guideNet]?.label ?? '—'}
                  <span className="ch-guide__count">{guideChannels.length} ch</span>
                </span>
                <button className="btn btn--sm btn--icon" onClick={() => guideNetStep(1)} aria-label="Next network">
                  <ChevronRight size={16} />
                </button>
              </div>
              <button className="btn btn--sm btn--icon" onClick={closeGuide} aria-label="Close guide">
                <X size={16} />
              </button>
            </header>
            <div className="ch-guide__cols" aria-hidden>
              <span>CH</span>
              <span />
              <span>Programme</span>
              <span>On now</span>
            </div>
            <div className="ch-guide__list" ref={guideList} role="listbox" aria-label={`${collections[guideNet]?.label ?? ''} channels`}>
              {guideChannels.length === 0 && <p className="hint ch-guide__empty">No channels on this network yet.</p>}
              {guideChannels.map((ch, i) => {
                const e = entries[ch.item.show.id] ?? ch.item.entry;
                const now = nowLine(ch.item, e);
                const on = current && keyOf(current) === keyOf(ch);
                return (
                  <button
                    key={keyOf(ch)}
                    data-gi={i}
                    role="option"
                    aria-selected={i === guideSel}
                    tabIndex={i === guideSel ? 0 : -1}
                    className={`ch-grow ${i === guideSel ? 'sel' : ''} ${on ? 'on' : ''}`}
                    onMouseEnter={() => setGuideSel(i)}
                    onClick={() => {
                      tune(ch);
                      closeGuide();
                    }}
                  >
                    <span className="ch-grow__no">{fmtCh(ch.no)}</span>
                    <span className="ch-grow__thumb">
                      <Poster show={ch.item.show} />
                    </span>
                    <span className="ch-grow__prog">
                      <span className="ch-grow__title">
                        {ch.item.show.title}
                        {on && <span className="tag tag--accent">Watching now</span>}
                      </span>
                      <span className="ch-grow__meta">{[yearRange(ch.item.show), ch.item.show.networks?.[0], ch.item.show.rating ? `★ ${ch.item.show.rating.toFixed(1)}` : undefined].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="ch-grow__now">
                      <span className="ch-grow__nowtxt">
                        <b>{now.tag}</b> {now.text}
                      </span>
                      {now.pct != null && (
                        <span className="bar">
                          <span className="bar__fill" style={{ width: `${now.pct}%` }} />
                        </span>
                      )}
                      {now.detail && <span className="ch-grow__detail">{now.detail}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <footer className="ch-guide__foot">
              <kbd>↑</kbd>
              <kbd>↓</kbd> select · <kbd>Enter</kbd> tune · <kbd>←</kbd>
              <kbd>→</kbd> network · <kbd>Esc</kbd> close
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

/** The broadcast lower-third: channel block + title + what's on. */
function LowerThird({ ch, fmtCh }: { ch: Channel; fmtCh: (n: number) => string }) {
  const entry = useLibrary((s) => s.entries[ch.item.show.id]) ?? ch.item.entry;
  const { show } = ch.item;
  const now = nowLine(ch.item, entry);
  const meta = [show.networks?.[0], show.rating ? `★ ${show.rating.toFixed(1)}` : undefined, yearRange(show)].filter(Boolean);
  return (
    <div className="ch-lower">
      <div className="ch-lower__ch">
        <span className="ch-lower__chl">CH</span>
        <span className="ch-lower__chn">{fmtCh(ch.no)}</span>
      </div>
      <div className="ch-lower__body">
        <div className="ch-lower__net">{ch.net}</div>
        <div className="ch-lower__title">{show.title}</div>
        <div className="ch-lower__meta">
          <span className="ch-lower__now">
            {now.tag}
            {now.text ? `: ${now.text}` : ''}
          </span>
          {now.pct != null && entry?.status === 'watching' && (
            <span className="ch-lower__bar" aria-hidden>
              <span style={{ width: `${now.pct}%` }} />
            </span>
          )}
          {meta.map((m) => (
            <span key={m} className="ch-lower__m">
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
