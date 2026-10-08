import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCheck, ChevronDown, ChevronUp, CornerDownLeft, Grid3x3, Info, ListVideo, Play, Plus, Undo2, Volume2, VolumeX } from 'lucide-react';
import { defaultCollection, useCollections } from './useCollections';
import { buildChannels, keyOf, neighbours, resolveTuned, stepChannel, type Channel, type Tuned } from './channel/model';
import { schedule } from './channel/schedule';
import { Guide } from './channel/Guide';
import { Poster } from '../components/Poster';
import { toast } from '../components/toast';
import { prefetchArtwork } from '../providers/artwork';
import { remember, showPath } from '../lib/showCache';
import { fmtEp, progressOf } from '../lib/progress';
import { yearRange } from '../lib/labels';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { useShowActions } from '../hooks/useShowActions';

/**
 * CHANNEL SURFER — flip through your shows on a retro TV set.
 * Every show is a channel (1…n, library first); lists are "networks" (inputs).
 * ↑/↓ · CH± · wheel · swipe change channel (static burst), ←/→ / tabs switch
 * network (picture collapses to a line, like changing inputs), digits tune
 * directly, G opens the guide, Enter opens the show.
 */

type Fx = 'static' | 'input' | 'fade';
interface Osd {
  id: number;
  kind: 'ch' | 'input' | 'nochan';
  text: string;
  sub?: string;
}

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

/** TV static: a tiny canvas of random grey pixels, scaled up, redrawn every frame — only while active. */
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
        const band = Math.random() < 0.06 ? 90 : 0; // horizontal tearing bands
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
  return <canvas ref={ref} className={`ch-noise ${active ? 'on' : ''}`} width={128} height={96} aria-hidden />;
}

export default function ChannelSurfer() {
  const { collections, recs } = useCollections();
  const nav = useNavigate();
  const reduced = useReducedMotion();

  const channels = useMemo(() => buildChannels(collections), [collections]);
  const pad = Math.max(2, String(channels.length).length);
  const fmtCh = useCallback((n: number) => String(n).padStart(pad, '0'), [pad]);

  // ── what's tuned (library-first default until the viewer picks; the library hydrates async) ──
  const [tuned, setTuned] = useState<Tuned>({ idx: 0 });
  const { cid, current } = useMemo(() => resolveTuned(channels, tuned, defaultCollection(collections)), [channels, tuned, collections]);
  const netIdx = Math.max(0, collections.findIndex((c) => c.id === cid));
  const net = collections[netIdx];
  const curKey = current ? keyOf(current) : `empty:${cid}`;
  // the show moved to another list (e.g. Start watching) → the TV followed it; remember that
  useEffect(() => {
    if (current && tuned.cid && current.cid !== tuned.cid) setTuned({ cid: current.cid, showId: current.item.show.id, idx: current.idx });
  }, [current, tuned.cid]);

  // pictures: what's on now loads eagerly; the channels either side are warmed so surfing never waits
  useEffect(() => {
    if (current) prefetchArtwork(neighbours(channels, current, 3).map((c) => c.item.show), 'backdrop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  const lastPerNet = useRef<Partial<Record<string, string>>>({});
  const prevKey = useRef<string | undefined>(undefined);
  const [canRecall, setCanRecall] = useState(false);
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
      if (current) {
        prevKey.current = keyOf(current);
        setCanRecall(true);
      }
      lastPerNet.current[ch.cid] = ch.item.show.id;
      pendingFx.current = kind;
      pendingOsd.current = kind === 'input' ? { kind: 'input', text: `INPUT: ${ch.net.toUpperCase()}`, sub: `CH ${fmtCh(ch.no)}` } : { kind: 'ch', text: `CH ${fmtCh(ch.no)}`, sub: ch.net };
      setTuned({ cid: ch.cid, showId: ch.item.show.id, idx: ch.idx });
    },
    [current, fmtCh],
  );
  const step = useCallback(
    (d: number) => {
      const ch = stepChannel(channels, current, d);
      if (ch) tune(ch, 'static');
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
      pendingFx.current = 'input';
      pendingOsd.current = { kind: 'input', text: `INPUT: ${c.label.toUpperCase()}`, sub: 'No signal' };
      setTuned({ cid: c.id, idx: 0 });
    },
    [collections, channels, cid, tune],
  );
  const netStep = useCallback(
    (d: number) => {
      const n = collections.length;
      if (n > 1) tuneNet((((netIdx + d) % n) + n) % n);
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

  // ── sound: off by default; the AudioContext only exists after the viewer turns it on ──
  const audio = useRef<AudioContext | null>(null);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const toggleSound = useCallback(() => {
    if (soundRef.current) return setSound(false);
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      setSound(true);
    } catch {
      setSound(false);
    }
  }, []);
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => undefined);
      audio.current = null;
    },
    [],
  );
  const hiss = (dur: number) => {
    const ctx = audio.current;
    if (!soundRef.current || !ctx || ctx.state === 'closed') return;
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
  };

  // ── the transition: the picture lags behind the tuned channel while the effect plays ──
  const screen = useRef<HTMLDivElement>(null);
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
    const id = ++fxSeq.current;
    setFx({ kind, id });
    if (kind !== 'fade') hiss(kind === 'input' ? 0.32 : 0.26);
    clearTimeout(swapT.current);
    clearTimeout(endT.current);
    const finish = () => {
      setFx((f) => (f?.id === id ? null : f));
      setPrevPic(undefined);
    };
    // the static keeps rolling until the new picture has actually loaded (max 1.2s) — never a blank screen
    const started = performance.now();
    const settle = () => {
      const img = screen.current?.querySelector<HTMLImageElement>('.ch-pic--cur img');
      if (kind === 'static' && img && !img.complete && performance.now() - started < 1200) endT.current = setTimeout(settle, 60);
      else finish();
    };
    const swap = () => {
      if (kind === 'fade') setPrevPic(picRef.current);
      picRef.current = curKey;
      setPic(curKey);
      if (nextOsd) setOsd({ ...nextOsd, id: ++osdSeq.current });
      endT.current = setTimeout(settle, kind === 'input' ? 390 : kind === 'static' ? 210 : 320);
    };
    const swapAt = kind === 'input' ? 250 : kind === 'static' ? 120 : 0;
    if (swapAt) swapT.current = setTimeout(swap, swapAt);
    else swap();
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
      if (!channels.length) return;
      const next = (digits + d).replace(/^0+(?=\d)/, '');
      if (next.length >= maxDigits) commitDigits(next);
      else setDigits(next);
    },
    [digits, maxDigits, commitDigits, channels.length],
  );
  useEffect(() => {
    if (!digits) return;
    const t = setTimeout(() => commitDigits(digits), 1000);
    return () => clearTimeout(t);
  }, [digits, commitDigits]);

  // ── keypad popover ("the full remote", on demand) ──
  const [keypad, setKeypad] = useState(false);
  const keypadBtn = useRef<HTMLButtonElement>(null);
  const keypadEl = useRef<HTMLDivElement>(null);
  const closeKeypad = useCallback((refocus = false) => {
    setKeypad(false);
    if (refocus) keypadBtn.current?.focus();
  }, []);
  useEffect(() => {
    if (!keypad) return;
    const h = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!keypadEl.current?.contains(t) && !keypadBtn.current?.contains(t)) setKeypad(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [keypad]);

  // ── guide ──
  const [guide, setGuide] = useState(false);
  const guideBtn = useRef<HTMLButtonElement>(null);
  const openGuide = useCallback(() => {
    setKeypad(false);
    setGuide(true);
  }, []);
  const closeGuide = useCallback(() => {
    setGuide(false);
    requestAnimationFrame(() => guideBtn.current?.focus());
  }, []);

  // ── keyboard (the guide handles its own keys while open) ──
  useEffect(() => {
    if (guide) return;
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof Element ? e.target : document.body;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"], .menu') || document.querySelector('.overlay')) return;
      const key = e.key;
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
      } else if (key === 'Escape') {
        if (digits) setDigits('');
        else if (keypad) closeKeypad(true);
        else return;
      } else if (key === 'Enter') {
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
  const wheel = useRef({ acc: 0, at: 0 });
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const w = (e: WheelEvent) => {
      e.preventDefault();
      const s = wheel.current;
      const now = performance.now();
      if (now - s.at < 220) return; // one notch per burst; trackpads send dozens
      s.acc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : 0;
      if (Math.abs(s.acc) > 40) {
        stepRef.current(s.acc > 0 ? 1 : -1);
        s.acc = 0;
        s.at = now;
      }
    };
    el.addEventListener('wheel', w, { passive: false });
    return () => el.removeEventListener('wheel', w);
  }, []);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('a, button')) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 36 && Math.abs(dy) > Math.abs(dx)) step(dy < 0 ? 1 : -1);
    else if (Math.abs(dx) > 56) netStep(dx < 0 ? 1 : -1);
  };

  const signal = !channels.length ? (recs.stage !== 'ready' ? 'tuning' : 'empty') : cid === 'foryou' && recs.stage !== 'ready' ? 'tuning' : 'quiet';

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
        {collections.map((c, i) => (
          <button key={c.id} className={`ch-net ${i === netIdx ? 'on' : ''}`} aria-pressed={i === netIdx} onClick={() => tuneNet(i)}>
            {c.label}
            <span className="ch-net__n">{c.items.length}</span>
          </button>
        ))}
      </nav>

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
                  {renderPicture(shown, `ch-pic--cur ${phase === 'out' && fx ? `ch-pic--out-${fx.kind}` : phase === 'in' && fx ? `ch-pic--in-${fx.kind}` : ''}`)}
                </div>
                <div className="ch-scan" aria-hidden />
                {!reduced && <Noise active={fx?.kind === 'static'} />}
                <div className="ch-line" aria-hidden />
                <div className="ch-vignette" aria-hidden />

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
                    {signal === 'tuning' ? (
                      <p>
                        <span className="spinner" /> Tuning in…
                      </p>
                    ) : signal === 'empty' ? (
                      <>
                        <p className="ch-nosignal__t">No signal</p>
                        <p>Add shows you've watched or want to watch — each one becomes a channel.</p>
                        <div className="ch-nosignal__cta">
                          <Link className="btn btn--primary btn--sm" to="/discover">
                            <Plus size={14} /> Find shows
                          </Link>
                          <Link className="btn btn--sm" to="/settings/import">
                            Import a list
                          </Link>
                        </div>
                      </>
                    ) : (
                      <p>Nothing on “{net?.label}” yet — try another network.</p>
                    )}
                  </div>
                )}
                <div className="ch-glass" aria-hidden />
              </div>
            </div>

            {/* the chin: one row of controls + the one thing to do with what's on */}
            <div className="ch-chin">
              <div className="ch-chin__brand" aria-hidden>
                <span className={`ch-led ${fx ? 'blink' : ''}`} />
                Dealo
              </div>
              <div className="ch-tune">
                <div className="ch-lcd" aria-hidden>
                  {digits ? digits.padEnd(maxDigits, '-') : current ? fmtCh(current.no) : '--'}
                </div>
                <div className="ch-rocker" role="group" aria-label="Channel">
                  <button className="ch-btn" onClick={() => step(-1)} disabled={!channels.length} aria-label="Channel down" title="Channel down (↓)">
                    <ChevronDown size={18} />
                    <span>CH</span>
                  </button>
                  <button className="ch-btn" onClick={() => step(1)} disabled={!channels.length} aria-label="Channel up" title="Channel up (↑)">
                    <ChevronUp size={18} />
                    <span>CH</span>
                  </button>
                </div>
              </div>
              <div className="ch-chin__act">{current && <NowAction ch={current} onOpen={open} />}</div>
              <div className="ch-tools">
                <button ref={guideBtn} className="ch-btn ch-btn--label" onClick={openGuide} aria-haspopup="dialog" title="Programme guide (G)">
                  <ListVideo size={17} />
                  <span>Guide</span>
                </button>
                <button
                  ref={keypadBtn}
                  className={`ch-btn ${keypad ? 'on' : ''}`}
                  onClick={() => setKeypad((k) => !k)}
                  aria-expanded={keypad}
                  aria-label="Number pad"
                  title="Type a channel number (0–9)"
                  disabled={!channels.length}
                >
                  <Grid3x3 size={17} />
                </button>
                <button className={`ch-btn ${sound ? 'on' : ''}`} onClick={toggleSound} aria-pressed={sound} aria-label="Static sound" title={sound ? 'Sound on (M)' : 'Sound off (M)'}>
                  {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
                </button>
                {keypad && (
                  <div className="ch-keypad" ref={keypadEl} role="group" aria-label="Number pad">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                      <button key={d} className="ch-key" onClick={() => pressDigit(d)}>
                        {d}
                      </button>
                    ))}
                    <button className="ch-key ch-key--fn" onClick={recall} disabled={!canRecall} aria-label="Last channel" title="Last channel (Backspace)">
                      <Undo2 size={15} />
                    </button>
                    <button className="ch-key" onClick={() => pressDigit('0')}>
                      0
                    </button>
                    <button
                      className="ch-key ch-key--fn"
                      onClick={() => {
                        if (digits) commitDigits(digits);
                        closeKeypad(true);
                      }}
                      aria-label={digits ? 'Tune now' : 'Close number pad'}
                    >
                      <CornerDownLeft size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="ch-tv__feet" aria-hidden>
            <span />
            <span />
          </div>
        </div>
      </div>

      <p className="ch-hint ch-hint--touch">Swipe the screen up or down to surf · sideways to change network</p>
      <p className="ch-hint ch-hint--keys">
        <kbd>↑</kbd>
        <kbd>↓</kbd> or scroll / swipe to surf · <kbd>←</kbd>
        <kbd>→</kbd> network · <kbd>0–9</kbd> tune · <kbd>G</kbd> guide · <kbd>Enter</kbd> details
      </p>

      {guide && (
        <Guide
          channels={channels}
          collections={collections}
          currentKey={current ? keyOf(current) : undefined}
          fmtCh={fmtCh}
          onTune={(ch) => {
            tune(ch, ch.cid === cid ? 'static' : 'input');
            closeGuide();
          }}
          onClose={closeGuide}
        />
      )}
    </div>
  );
}

/** The broadcast lower-third: channel block, title, the schedule line, a little meta. */
function LowerThird({ ch, fmtCh }: { ch: Channel; fmtCh: (n: number) => string }) {
  const entry = useLibrary((s) => s.entries[ch.item.show.id]) ?? ch.item.entry;
  const { show, rec } = ch.item;
  // reruns don't need a NEXT — your rating says more
  const slots = schedule(ch.item, entry, entry?.status === 'completed' ? 1 : 2);
  const p = entry?.status === 'watching' ? progressOf(entry) : undefined;
  const because = rec?.reasons.find((r) => r.kind === 'because')?.label;
  const meta = [show.networks?.[0], show.rating ? `★ ${show.rating.toFixed(1)}` : undefined, yearRange(show)].filter(Boolean);
  return (
    <div className="ch-lower">
      <div className="ch-lower__ch">
        <span className="ch-lower__chl">CH</span>
        <span className="ch-lower__chn">{fmtCh(ch.no)}</span>
      </div>
      <div className="ch-lower__body">
        <div className="ch-lower__title">{show.title}</div>
        <div className="ch-lower__sched">
          {rec && (
            <span className="ch-lower__slot ch-lower__slot--match">
              <b>Match</b> {rec.match}%
            </span>
          )}
          {slots.map((s, i) => (
            <span key={i} className={`ch-lower__slot ch-lower__slot--${s.kind}`}>
              <b>{s.tag}</b> {s.label}
            </span>
          ))}
          {entry?.status === 'completed' && entry.rating != null && (
            <span className="ch-lower__slot">
              <b>You</b> ★ {entry.rating}/10
            </span>
          )}
        </div>
        <div className="ch-lower__meta">
          {p && p.total > 0 && (
            <span className="ch-lower__prog">
              <span className="ch-lower__bar" aria-hidden>
                <span style={{ width: `${p.pct}%` }} />
              </span>
              {p.watched}/{p.total}
            </span>
          )}
          {because && <span className="ch-lower__m">{because}</span>}
          {meta.map((m) => (
            <span key={m} className="ch-lower__m">
              {m}
            </span>
          ))}
        </div>
        {show.overview && <p className="ch-lower__ov">{show.overview}</p>}
      </div>
    </div>
  );
}

/** The one obvious thing to do with what's on, plus Details. */
function NowAction({ ch, onOpen }: { ch: Channel; onOpen: () => void }) {
  const entry = useLibrary((s) => s.entries[ch.item.show.id]);
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  const actions = useShowActions();
  const { show } = ch.item;
  let primary: { label: string; icon: typeof Play; run: () => void } | undefined;
  if (entry?.status === 'watching') {
    const next = progressOf(entry).next;
    if (next && entry.seasonSizes?.length)
      primary = {
        label: `Watched ${fmtEp(next)}`,
        icon: CheckCheck,
        run: () => {
          toggleEpisode(entry.id, next.season, next.episode, show.runtime);
          toast(`✓ ${show.title} ${fmtEp(next)}`, { label: 'Undo', run: () => toggleEpisode(entry.id, next.season, next.episode) });
        },
      };
  } else if (entry?.status === 'plan') primary = { label: 'Start watching', icon: Play, run: () => actions.setStatus(show, 'watching') };
  else if (entry?.status === 'on_hold') primary = { label: 'Resume', icon: Play, run: () => actions.setStatus(show, 'watching') };
  else if (!entry) primary = { label: 'Watchlist', icon: Plus, run: () => actions.watchlist(show) };
  return (
    <>
      {primary && (
        <button className="btn btn--primary ch-act" onClick={primary.run}>
          <primary.icon size={16} /> {primary.label}
        </button>
      )}
      <button className={`btn ch-act ${primary ? 'ch-act--2' : 'btn--primary'}`} onClick={onOpen} title="Show page (Enter)">
        <Info size={16} /> Details
      </button>
    </>
  );
}
