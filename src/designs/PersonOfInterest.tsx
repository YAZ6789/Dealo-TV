import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Compass, Upload } from 'lucide-react';
import { useCollections, type Item } from './useCollections';
import { useCalmFx, useFitArtTitles, useMedia } from './ShowHud';
import { useSettings } from '../store/settings';
import { prefetchArtwork } from '../providers/artwork';
import { fmtEp, progressOf } from '../lib/progress';
import { Feed } from './poi/Feed';
import { Cut, type CutSpec } from './poi/Cut';
import { Dossier } from './poi/Dossier';
import { Boot, Clock, Ticker } from './poi/Hud';
import { KIND, buildSections, cutFrames, nextFeed, wallColumns, type Section } from './poi/logic';

/**
 * PERSON OF INTEREST — your TV life from the Machine's point of view.
 *
 * Home is a wall of CCTV feeds, one per show, grouped library-first:
 * cases closed (watched, white box), active numbers (watching, yellow box),
 * incoming numbers (watchlist, dashed yellow), dormant (on hold) and a
 * smaller "the Machine suggests" strip of recommendations. Selecting a feed
 * plays the show's signature cut — hard cuts through other cameras, static,
 * a stepped zoom and the tracking box locking on — and opens the subject's
 * file. The design carries its own look whatever the skin or light mode.
 *
 * Keys: arrows move between feeds, Enter opens a file, Esc returns to the
 * wall, ← → step between subjects inside a file. Taps during a cut skip it.
 */

const LIB_ORDER: Section['id'][] = ['closed', 'active', 'incoming'];

export default function PersonOfInterest() {
  const { collections, recs } = useCollections();
  const sections = useMemo(() => buildSections(collections), [collections]);
  const library = sections.filter((s) => s.id !== 'suggest');
  const suggest = sections.find((s) => s.id === 'suggest');
  const libCount = library.reduce((a, s) => a + s.items.length, 0);

  const reduceFx = useSettings((s) => s.reduceFx);
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const fade = reduceFx || reducedMotion;
  const calm = useCalmFx();

  const root = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(() => (typeof window === 'undefined' ? 4 : wallColumns(innerWidth, innerHeight)));
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setCols(wallColumns(el.clientWidth || innerWidth, innerHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      removeEventListener('resize', measure);
    };
  }, []);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useFitArtTitles(root, [sections, cols, expanded]);
  const [open, setOpen] = useState<{ sid: Section['id']; list: Item[]; index: number } | null>(null);
  const [cut, setCut] = useState<CutSpec | null>(null);
  const cutSeq = useRef(0);
  const returnTo = useRef<string | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // latest values for the stable callbacks below
  const live = useRef({ sections, fade });
  live.current = { sections, fade };
  const allFeeds = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const allRef = useRef(allFeeds);
  allRef.current = allFeeds;

  /** After coming back from a file: focus that feed and flash its box locking. */
  const markReturn = useCallback(() => {
    const id = returnTo.current;
    const el = id ? root.current?.querySelector<HTMLElement>(`[data-poi-id="${CSS.escape(id)}"]`) : null;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
    el.classList.add('poi-feed--lock');
    clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => el.classList.remove('poi-feed--lock'), 700);
  }, []);
  useEffect(() => () => clearTimeout(lockTimer.current), []);

  const openFeed = useCallback((item: Item, el: HTMLElement) => {
    const sid = el.closest('[data-poi-section]')?.getAttribute('data-poi-section') as Section['id'] | undefined;
    const sec = live.current.sections.find((s) => s.id === sid);
    const list = sec?.items.length ? sec.items : [item];
    const index = Math.max(0, list.findIndex((x) => x.show.id === item.show.id));
    returnTo.current = item.show.id;
    prefetchArtwork([item.show], 'backdrop');
    setOpen({ sid: sec?.id ?? 'suggest', list, index });
    if (live.current.fade) return;
    const r = (el.querySelector('.poi-feed__screen') ?? el).getBoundingClientRect();
    const id = ++cutSeq.current;
    setCut({ id, mode: 'in', subject: item, from: { left: r.left, top: r.top, width: r.width, height: r.height }, frames: cutFrames(allRef.current, item.show.id, 2, id) });
  }, []);

  const closeFile = useCallback(() => {
    setOpen(null);
    if (live.current.fade) {
      requestAnimationFrame(markReturn);
      return;
    }
    const id = ++cutSeq.current;
    setCut({ id, mode: 'out', frames: cutFrames(allRef.current, returnTo.current ?? '', 1, id) });
  }, [markReturn]);

  const cutMode = useRef<CutSpec['mode'] | null>(null);
  cutMode.current = cut?.mode ?? null;
  const finishCut = useCallback(() => {
    const wasOut = cutMode.current === 'out';
    setCut(null);
    if (wasOut) requestAnimationFrame(markReturn);
  }, [markReturn]);

  // any key during a cut skips straight to the end (and does nothing else)
  useEffect(() => {
    if (!cut) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      finishCut();
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [cut, finishCut]);

  // the page behind a file doesn't scroll
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  // arrow keys move between feeds across the whole wall
  const onWallKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const cur = (e.target as HTMLElement).closest<HTMLElement>('[data-poi-feed]');
    if (!cur || !root.current) return;
    const feeds = [...root.current.querySelectorAll<HTMLElement>('[data-poi-feed]')];
    const boxes = feeds.map((f) => {
      const r = f.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const j = nextFeed(boxes, feeds.indexOf(cur), e.key);
    e.preventDefault();
    if (j >= 0 && feeds[j] !== cur) {
      feeds[j].focus({ preventScroll: true });
      feeds[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  // eager artwork for the first screen of feeds, warm the cache for the rest
  const eagerCount = cols * 3;
  useEffect(() => {
    const lib = allFeeds.filter((x) => x.entry);
    prefetchArtwork(lib.slice(eagerCount, eagerCount + 30).map((x) => x.show), 'backdrop');
    if (suggest) prefetchArtwork(suggest.items.slice(0, 8).map((x) => x.show), 'backdrop');
  }, [allFeeds, eagerCount, suggest]);

  const jump = (id: Section['id']) => {
    const el = document.getElementById(`poi-sec-${id}`);
    el?.scrollIntoView({ behavior: fade ? 'auto' : 'smooth', block: 'start' });
    el?.querySelector<HTMLElement>('[data-poi-feed]')?.focus({ preventScroll: true });
  };

  const ticker = useMemo(() => {
    const lines = [libCount ? `ANALYZING ${libCount} SUBJECT${libCount === 1 ? '' : 'S'}…` : 'STANDING BY · NO SUBJECTS UNDER OBSERVATION'];
    const active = library.find((s) => s.id === 'active')?.items[0];
    const next = active?.entry ? progressOf(active.entry).next : undefined;
    if (active && next) lines.push(`NEXT ACTIVE NUMBER: ${active.show.title.toUpperCase()} ${fmtEp(next)}`);
    const closed = library.find((s) => s.id === 'closed')?.items ?? [];
    const rated = closed.map((x) => x.entry?.rating).filter((r): r is number => r != null);
    if (closed.length) lines.push(`${closed.length} CASE${closed.length === 1 ? '' : 'S'} CLOSED${rated.length ? ` · AVG RATING ${(rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1)}` : ''}`);
    if (suggest?.items.length) lines.push(`CROSS-REFERENCING ${suggest.items.length} POSSIBLE MATCHES…`);
    return lines;
  }, [library, libCount, suggest]);

  let running = 0;
  const openSection = open ? sections.find((s) => s.id === open.sid) : undefined;

  return (
    <div className={`poi poi-theme ${calm ? 'poi--calm' : ''}`} ref={root} style={{ '--cols': cols } as React.CSSProperties} onKeyDown={onWallKey}>
      <Boot feeds={libCount} skip={fade} />

      <header className="poi-hud">
        <div className="poi-hud__line" aria-hidden>
          <span className="poi-hud__rec">
            <i className="poi-rec poi-rec--live" /> REC
          </span>
          <span className="poi-hud__feeds">
            {libCount + (suggest?.items.length ?? 0)} FEEDS ONLINE
          </span>
          <Ticker lines={ticker} calm={calm} />
          <Clock calm={calm} />
        </div>
        <div className="poi-hud__head">
          <h1 className="poi-hud__title">Your numbers</h1>
          <p className="poi-hud__sub">Every show you track is a live feed. Select one to pull its file.</p>
        </div>
        {libCount > 0 && (
          <nav className="poi-board" aria-label="Jump to a list">
            {LIB_ORDER.map((id) => {
              const s = library.find((x) => x.id === id);
              const k = KIND[id as keyof typeof KIND];
              const count = s?.items.length ?? 0;
              return (
                <button key={id} type="button" className={`poi-board__tile poi-tone--${k.tone} ${k.dashed ? 'poi-feed--dashed' : ''}`} onClick={() => jump(id)} disabled={!count}>
                  <span className="poi-board__code" aria-hidden>
                    {k.code}
                  </span>
                  <span className="poi-board__n">{count}</span>
                  <span className="poi-board__plain">{k.plain}</span>
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {libCount === 0 && (
        <section className="poi-empty">
          <p className="poi-empty__code" aria-hidden>
            NO SUBJECTS UNDER OBSERVATION
          </p>
          <h2>Your library is empty</h2>
          <p>Add shows you've watched, are watching or want to watch — each becomes a feed on this wall.</p>
          <div className="poi-empty__actions">
            <Link to="/discover" className="poi-btn poi-btn--primary">
              <Compass size={16} /> Discover shows
            </Link>
            <Link to="/settings/import" className="poi-btn">
              <Upload size={16} /> Import a list
            </Link>
          </div>
        </section>
      )}

      {library.map((sec) => {
        const cap = sec.id === 'dormant' ? cols : cols * 2;
        const all = !!expanded[sec.id];
        const shown = all ? sec.items : sec.items.slice(0, cap);
        const start = running;
        running += shown.length;
        const k = KIND[sec.kind];
        return (
          <section key={sec.id} id={`poi-sec-${sec.id}`} className={`poi-sec poi-sec--${sec.id}`} data-poi-section={sec.id} aria-labelledby={`poi-h-${sec.id}`}>
            <header className="poi-sec__head">
              <span className={`poi-swatch poi-tone--${k.tone} ${k.dashed ? 'poi-feed--dashed' : ''}`} aria-hidden />
              <h2 id={`poi-h-${sec.id}`} className="poi-sec__title">
                {sec.title}
              </h2>
              <span className="poi-sec__plain">
                {sec.plain} · {sec.items.length} feed{sec.items.length === 1 ? '' : 's'}
              </span>
            </header>
            <ul className="poi-grid">
              {shown.map((it, i) => (
                <li key={it.show.id}>
                  <Feed item={it} eager={start + i < eagerCount} onOpen={openFeed} />
                </li>
              ))}
            </ul>
            {sec.items.length > cap && (
              <button type="button" className="poi-more" onClick={() => setExpanded((e) => ({ ...e, [sec.id]: !all }))} aria-expanded={all}>
                {all ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {all ? 'Show fewer' : `Show all ${sec.items.length} feeds`}
              </button>
            )}
          </section>
        );
      })}

      <section id="poi-sec-suggest" className="poi-sec poi-sec--suggest" data-poi-section="suggest" aria-labelledby="poi-h-suggest">
        <header className="poi-sec__head">
          <span className="poi-swatch poi-tone--white" aria-hidden />
          <h2 id="poi-h-suggest" className="poi-sec__title">
            The Machine suggests
          </h2>
          <span className="poi-sec__plain">Not on your lists yet · best matches first</span>
        </header>
        {suggest && suggest.items.length > 0 ? (
          <ul className="poi-strip">
            {suggest.items.slice(0, 24).map((it, i) => (
              <li key={it.show.id}>
                <Feed item={it} small eager={libCount === 0 && i < eagerCount} onOpen={openFeed} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="poi-analyzing" role="status">
            {recs.output ? 'Nothing new to suggest right now.' : 'Analyzing your taste…'}
          </p>
        )}
      </section>

      {open && (
        <Dossier
          list={open.list}
          index={open.index}
          sectionLabel={openSection ? KIND[openSection.kind].plain : 'File'}
          onIndex={(index) => {
            returnTo.current = open.list[index]?.show.id ?? returnTo.current;
            setOpen((o) => (o ? { ...o, index } : o));
          }}
          onClose={closeFile}
          fade={fade}
        />
      )}
      {cut && <Cut spec={cut} onDone={finishCut} />}
    </div>
  );
}
