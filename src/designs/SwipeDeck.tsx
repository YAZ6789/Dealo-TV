import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Clock,
  Crown,
  Eye,
  Heart,
  Info,
  Meh,
  PartyPopper,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { BlockedEntry, LibraryEntry, RecFeedback, ShowId } from '../types';
import { useCollections, type Collection, type Item } from './useCollections';
import { useLibrary } from '../store/library';
import { useShowActions } from '../hooks/useShowActions';
import { useSettings } from '../store/settings';
import { Poster } from '../components/Poster';
import { useToasts } from '../components/toast';
import { GENRE_LABELS } from '../lib/genres';
import { relTime, yearRange } from '../lib/labels';
import { remember, showPath } from '../lib/showCache';
import { useAmbientShow } from '../lib/ambient';

/**
 * SWIPE DECK — "Swipe right to save, left to skip — rate fast."
 * A physical stack of show cards. Drag (mouse/touch), arrow keys or the
 * buttons: → want to watch, ← not for me, ↑ seen it (+ quick rating),
 * ↓ skip. "Rate my watched" turns swipes into ratings. Z / Backspace undoes.
 */

/* ───────────────────────── pure logic (unit-tested) ───────────────────────── */

export type Dir = 'right' | 'left' | 'up' | 'down';
/** Library modes first (what the app is about), recommendations after. */
export type Mode = 'rate' | 'watchlist' | 'discover' | 'binge' | 'gems';
export const MODE_ORDER: Mode[] = ['rate', 'watchlist', 'discover', 'binge', 'gems'];
const LIBRARY_MODES: Mode[] = ['rate', 'watchlist'];
export const DIRS: Dir[] = ['left', 'down', 'up', 'right'];

/** Rating given by each swipe in "Rate my watched". */
export const RATE_FOR: Record<Dir, number> = { right: 9, left: 3, up: 10, down: 6 };

const COLLECTION_FOR: Record<Exclude<Mode, 'rate' | 'watchlist'>, Collection['id']> = { discover: 'foryou', binge: 'binge', gems: 'gems' };
export const DECK_SIZE = 40;

/** Fraction of the card size a drag must travel to commit, and the flick speed (px/ms) that commits a shorter drag. */
const H_COMMIT = 0.3;
const V_COMMIT = 0.24;
const FLICK = 0.55;

/** Where a drag is heading and how close (0–1) it is to committing. */
export function dragProgress(dx: number, dy: number, w: number, h: number): { dir: Dir | null; p: number } {
  const ax = Math.abs(dx) / (w * H_COMMIT);
  const ay = Math.abs(dy) / (h * V_COMMIT);
  if (Math.max(ax, ay) < 0.08) return { dir: null, p: 0 };
  if (ax >= ay) return { dir: dx > 0 ? 'right' : 'left', p: Math.min(1, ax) };
  return { dir: dy < 0 ? 'up' : 'down', p: Math.min(1, ay) };
}

/** On release: commit to a direction (far enough, or flicked fast enough) or spring back (null). */
export function decideSwipe(dx: number, dy: number, vx: number, vy: number, w: number, h: number): Dir | null {
  const { dir, p } = dragProgress(dx, dy, w, h);
  if (!dir) return null;
  if (p >= 1) return dir;
  const horizontal = dir === 'left' || dir === 'right';
  const v = horizontal ? vx : vy;
  const d = horizontal ? dx : dy;
  // A quick flick in the same direction as the drag commits early.
  if (Math.abs(v) >= FLICK && Math.sign(v) === Math.sign(d) && p >= 0.25) return dir;
  return null;
}

/** Tilt for a drag: proportional to horizontal travel, inverted when the card was grabbed by its lower half. */
export function tiltFor(dx: number, w: number, grabbedLow: boolean): number {
  const r = Math.max(-18, Math.min(18, (dx / Math.max(w, 1)) * 22));
  return grabbedLow ? -r : r;
}

/** The cards for a mode: a snapshot of the source minus anything already in the library, blocked, or swiped this session. */
export function buildDeck(
  mode: Mode,
  collections: Collection[],
  entries: Record<ShowId, LibraryEntry>,
  blocked: Record<ShowId, unknown>,
  exclude: ReadonlySet<ShowId> = new Set(),
): Item[] {
  const seen = new Set<ShowId>();
  const keep = (id: ShowId) => {
    if (seen.has(id) || exclude.has(id)) return false;
    seen.add(id);
    return true;
  };
  if (mode === 'rate') {
    return Object.values(entries)
      .filter((e) => e.status === 'completed' && e.rating == null && !blocked[e.id])
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
      .filter((e) => keep(e.id))
      .slice(0, DECK_SIZE)
      .map((e) => ({ show: e.show, entry: e }));
  }
  if (mode === 'watchlist') {
    return Object.values(entries)
      .filter((e) => e.status === 'plan' && !blocked[e.id])
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .filter((e) => keep(e.id))
      .slice(0, DECK_SIZE)
      .map((e) => ({ show: e.show, entry: e }));
  }
  const col = collections.find((c) => c.id === COLLECTION_FOR[mode]);
  return (col?.items ?? []).filter((it) => !entries[it.show.id] && !blocked[it.show.id] && keep(it.show.id)).slice(0, DECK_SIZE);
}

/** Cards still to swipe, in order. Drops anything that left the "to decide" pool elsewhere (added, blocked or rated meanwhile). */
export function remainingOf(
  deck: { items: Item[]; done: ShowId[] } | undefined,
  mode: Mode,
  entries: Record<ShowId, LibraryEntry>,
  blocked: Record<ShowId, unknown>,
): Item[] {
  if (!deck) return [];
  const done = new Set(deck.done);
  return deck.items.filter((it) => {
    const id = it.show.id;
    if (done.has(id)) return false;
    if (mode === 'rate') return entries[id]?.status === 'completed' && entries[id].rating == null;
    if (mode === 'watchlist') return entries[id]?.status === 'plan';
    return !entries[id] && !blocked[id];
  });
}

/** The deck to open on: your own library first (unrated finished shows, then the watchlist), else recommendations. */
export function defaultMode(sizes: Partial<Record<Mode, number>>): Mode {
  return LIBRARY_MODES.find((m) => (sizes[m] ?? 0) > 0) ?? 'discover';
}

/** What a swipe means, per mode. */
export function outcomeLabel(mode: Mode, dir: Dir, rating?: number): string {
  if (mode === 'rate') return `Rated ${RATE_FOR[dir]}/10`;
  if (mode === 'watchlist' && dir !== 'up') return { right: 'Started watching', left: 'Removed from watchlist', down: 'Kept for later' }[dir];
  if (dir === 'right') return 'Saved';
  if (dir === 'left') return 'Not for me';
  if (dir === 'up') return rating != null ? `Seen · ${rating}/10` : 'Seen it';
  return 'Skipped';
}

/* ───────────────────────── session store (survives visiting a show page) ───────────────────────── */

interface Snap {
  entry?: LibraryEntry;
  blocked?: BlockedEntry;
  feedback?: RecFeedback;
  t: string;
}
export interface LogEntry {
  key: number;
  item: Item;
  dir: Dir;
  mode: Mode;
  rating?: number;
  snap: Snap;
}
interface DeckState {
  items: Item[];
  done: ShowId[];
}
interface SessionState {
  /** Undefined until the user picks (or swipes): the default follows the library as it hydrates. */
  mode?: Mode;
  decks: Partial<Record<Mode, DeckState>>;
  log: LogEntry[];
}
const useSession = create<SessionState>()(() => ({ decks: {}, log: [] }));
let logSeq = 1;

/** Swipes are fast, so their "→ Watchlist · Undo" toasts are kept to one at a time. */
let swipeToasts: number[] = [];
function trackToasts(run: () => void) {
  const t = useToasts.getState();
  const before = new Set(t.toasts.map((x) => x.id));
  for (const id of swipeToasts) t.dismiss(id);
  run();
  const mine = useToasts.getState().toasts.filter((x) => !before.has(x.id)).map((x) => x.id);
  swipeToasts = mine;
  // On phones toasts sit over the deck switcher, so swipe toasts get a short life there.
  if (mine.length && typeof matchMedia !== 'undefined' && matchMedia('(max-width: 860px)').matches) {
    setTimeout(() => mine.forEach((id) => useToasts.getState().dismiss(id)), 2600);
  }
}

function takeSnap(id: ShowId): Snap {
  const s = useLibrary.getState();
  return { entry: s.entries[id], blocked: s.blocked[id], feedback: s.feedback[id], t: new Date().toISOString() };
}
/** Put a show's library state back exactly as it was before a swipe (entry, block, feedback, activity). */
function restoreSnap(id: ShowId, snap: Snap) {
  useLibrary.setState((s) => {
    const entries = { ...s.entries };
    const blocked = { ...s.blocked };
    const feedback = { ...s.feedback };
    if (snap.entry) entries[id] = snap.entry;
    else delete entries[id];
    if (snap.blocked) blocked[id] = snap.blocked;
    else delete blocked[id];
    if (snap.feedback) feedback[id] = snap.feedback;
    else delete feedback[id];
    const activity = s.activity.filter((a) => !(a.id === id && a.at >= snap.t));
    return { entries, blocked, feedback, activity, updatedAt: new Date().toISOString() };
  });
}

/* ───────────────────────── presentation helpers ───────────────────────── */

const MODES: { id: Mode; label: string; short: string; blurb: string }[] = [
  { id: 'rate', label: 'Rate my watched', short: 'Rate', blurb: 'Finished shows without a rating' },
  { id: 'watchlist', label: 'Watchlist', short: 'Watchlist', blurb: 'Triage what you saved: start it, keep it or let it go' },
  { id: 'discover', label: 'For you', short: 'For you', blurb: 'Fresh picks from your taste profile' },
  { id: 'binge', label: 'Quick binges', short: 'Binges', blurb: 'One or two seasons — done in a weekend' },
  { id: 'gems', label: 'Hidden gems', short: 'Gems', blurb: 'Brilliant and criminally under-watched' },
];

interface DirMeta {
  stamp: string;
  button: string;
  /** Small number on the button disc (the rating a swipe gives in "Rate my watched"). */
  badge?: string;
  icon: LucideIcon;
  key: LucideIcon;
  tone: 'ok' | 'danger' | 'accent' | 'dim';
}
function dirMeta(mode: Mode, dir: Dir): DirMeta {
  if (mode === 'rate') {
    return {
      right: { stamp: 'Loved · 9', button: 'Loved', badge: '9', icon: Heart, key: ArrowRight, tone: 'ok' as const },
      left: { stamp: 'Disliked · 3', button: 'Disliked', badge: '3', icon: ThumbsDown, key: ArrowLeft, tone: 'danger' as const },
      up: { stamp: 'Great · 10', button: 'Great', badge: '10', icon: Crown, key: ArrowUp, tone: 'accent' as const },
      down: { stamp: 'Meh · 6', button: 'Meh', badge: '6', icon: Meh, key: ArrowDown, tone: 'dim' as const },
    }[dir];
  }
  if (mode === 'watchlist') {
    return {
      right: { stamp: 'Start watching', button: 'Start', icon: Play, key: ArrowRight, tone: 'ok' as const },
      left: { stamp: 'Not anymore', button: 'Remove', icon: Trash2, key: ArrowLeft, tone: 'danger' as const },
      up: { stamp: 'Already seen', button: 'Seen it', icon: Eye, key: ArrowUp, tone: 'accent' as const },
      down: { stamp: 'Keep for later', button: 'Later', icon: Clock, key: ArrowDown, tone: 'dim' as const },
    }[dir];
  }
  return {
    right: { stamp: 'Want to watch', button: 'Want it', icon: Heart, key: ArrowRight, tone: 'ok' as const },
    left: { stamp: 'Not for me', button: 'Not for me', icon: X, key: ArrowLeft, tone: 'danger' as const },
    up: { stamp: 'Seen it', button: 'Seen it', icon: Eye, key: ArrowUp, tone: 'accent' as const },
    down: { stamp: 'Skip', button: 'Skip', icon: ArrowDown, key: ArrowDown, tone: 'dim' as const },
  }[dir];
}

function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const h = () => setR(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return r;
}

interface Pose {
  x: number;
  y: number;
  rot: number;
}
const tf = (p: Pose) => `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}deg)`;

function flingTarget(dir: Dir, from: Pose): Pose {
  const W = innerWidth * 0.6 + 520;
  const H = innerHeight * 0.6 + 640;
  if (dir === 'right') return { x: W, y: from.y * 1.6 + 40, rot: Math.max(from.rot, 4) + 16 };
  if (dir === 'left') return { x: -W, y: from.y * 1.6 + 40, rot: Math.min(from.rot, -4) - 16 };
  if (dir === 'up') return { x: from.x * 1.6, y: -H, rot: from.rot * 1.4 };
  return { x: from.x * 1.6, y: H, rot: from.rot * 1.4 };
}

/** "3d ago", or "Aug 18" (plus the year when it isn't this year) — short enough for one eyebrow line on a phone. */
function shortWhen(iso?: string): string {
  if (!iso) return '';
  if (Date.now() - Date.parse(iso) < 86400 * 30 * 1000) return relTime(iso);
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/* ───────────────────────── card face ───────────────────────── */

const CardFace = memo(function CardFace({ item, mode }: { item: Item; mode: Mode }) {
  const { show, rec, entry } = item;
  const because = rec?.reasons.find((r) => r.kind === 'because');
  const reasons = (rec?.reasons ?? []).slice(0, 2);
  const eyebrow =
    mode === 'rate'
      ? `Finished ${shortWhen(entry?.completedAt)} · how was it?`
      : mode === 'watchlist'
        ? `Watchlist · added ${shortWhen(entry?.addedAt)}`
        : because
        ? 'Top pick for you'
        : rec?.exploratory
          ? 'Outside your usual'
          : 'Recommended';
  const meta = [
    yearRange(show),
    show.seasonCount ? `${show.seasonCount} season${show.seasonCount > 1 ? 's' : ''}` : undefined,
    show.networks?.[0],
    show.rating ? `★ ${show.rating.toFixed(1)}` : undefined,
  ].filter(Boolean);
  return (
    <>
      <div className="swipe-card__media">
        <Poster show={show} variant="wide" eager />
        {rec ? (
          <div className="swipe-card__match" aria-label={`${rec.match}% match`}>
            <b>{rec.match}%</b>
            <span>match</span>
          </div>
        ) : show.rating ? (
          <div className="swipe-card__match" aria-label={`Rated ${show.rating.toFixed(1)} by viewers`}>
            <b>★ {show.rating.toFixed(1)}</b>
            <span>viewers</span>
          </div>
        ) : null}
      </div>
      <div className="swipe-card__info">
        <div className="swipe-card__eyebrow">{eyebrow}</div>
        <h2 className="swipe-card__title">{show.title}</h2>
        {meta.length > 0 && (
          <div className="swipe-card__meta">
            {meta.map((m) => (
              <span key={m} className={m === show.networks?.[0] ? 'is-net' : undefined}>
                {m}
              </span>
            ))}
          </div>
        )}
        {show.genres.length > 0 && (
          <div className="swipe-card__genres">
            {show.genres.slice(0, 3).map((g) => (
              <span key={g} className="chip chip--sm">
                {GENRE_LABELS[g]}
              </span>
            ))}
          </div>
        )}
        {reasons.length > 0 && (
          <ul className="swipe-card__reasons">
            {reasons.map((r) => (
              <li key={r.label}>
                <Sparkles size={14} aria-hidden />
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        )}
        {show.overview && <p className="swipe-card__overview">{show.overview}</p>}
      </div>
      {DIRS.map((d) => {
        const m = dirMeta(mode, d);
        const Icon = m.icon;
        return (
          <div key={d} className={`swipe-stamp swipe-stamp--${d} tone-${m.tone}`} aria-hidden>
            <Icon size={22} strokeWidth={2.6} />
            <span>{m.stamp}</span>
          </div>
        );
      })}
    </>
  );
});

/* ───────────────────────── stack + flying cards ───────────────────────── */

interface Fly {
  key: number;
  item: Item;
  dir: Dir;
  mode: Mode;
  from: Pose;
}

function FlyingCard({ fly, reduced, onDone }: { fly: Fly; reduced: boolean; onDone: (key: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = tf(fly.from);
    void el.offsetWidth; // commit the start pose before animating
    el.dataset.go = '1';
    if (reduced) el.style.opacity = '0';
    else {
      el.style.transform = tf(flingTarget(fly.dir, fly.from));
      el.style.opacity = '0';
    }
    const t = setTimeout(() => onDone(fly.key), reduced ? 260 : 560);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="swipe-card swipe-card--fly" data-dir={fly.dir} aria-hidden>
      <div className="swipe-card__body" ref={ref}>
        <CardFace item={fly.item} mode={fly.mode} />
      </div>
    </div>
  );
}

interface StackCardProps {
  item: Item;
  depth: number;
  mode: Mode;
  returnFrom?: Dir;
  reduced: boolean;
  bodyRef?: React.Ref<HTMLDivElement>;
  handlers?: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  };
}

function StackCard({ item, depth, mode, returnFrom, reduced, bodyRef, handlers }: StackCardProps) {
  const inner = useRef<HTMLDivElement>(null);
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      inner.current = el;
      if (typeof bodyRef === 'function') bodyRef(el);
      else if (bodyRef) (bodyRef as React.RefObject<HTMLDivElement | null>).current = el;
    },
    [bodyRef],
  );
  // Undo: the card flies back in from where it left.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !returnFrom) return;
    el.dataset.instant = '1';
    if (reduced) el.style.opacity = '0';
    else el.style.transform = tf(flingTarget(returnFrom, { x: 0, y: 0, rot: 0 }));
    void el.offsetWidth;
    delete el.dataset.instant;
    el.dataset.return = '1';
    el.style.transform = '';
    el.style.opacity = '';
    const t = setTimeout(() => delete el.dataset.return, 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const top = depth === 0;
  return (
    <div className={`swipe-card ${top ? 'is-top' : ''}`} data-depth={depth} style={{ '--i': depth, zIndex: 10 - depth } as CSSProperties} aria-hidden={!top}>
      <div
        ref={setRefs}
        className="swipe-card__body"
        tabIndex={top ? 0 : -1}
        role={top ? 'group' : undefined}
        aria-roledescription={top ? 'card' : undefined}
        aria-label={top ? `${item.show.title}. Arrow keys to swipe, Enter to open.` : undefined}
        {...(top ? handlers : {})}
      >
        <CardFace item={item} mode={mode} />
      </div>
    </div>
  );
}

/* ───────────────────────── main design ───────────────────────── */

export default function SwipeDeck() {
  const { collections, recs } = useCollections();
  const entries = useLibrary((s) => s.entries);
  const blocked = useLibrary((s) => s.blocked);
  const hydrated = useLibrary((s) => s.hydrated);
  const actions = useShowActions();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const reduceFx = useSettings((s) => s.reduceFx);
  const segRef = useRef<HTMLDivElement>(null);

  const picked = useSession((s) => s.mode);
  const decks = useSession((s) => s.decks);
  const log = useSession((s) => s.log);

  const swipedIds = useMemo(() => new Set(log.map((l) => l.item.show.id)), [log]);
  const sources = useMemo(() => {
    const out = {} as Record<Mode, Item[]>;
    for (const m of MODES) out[m.id] = buildDeck(m.id, collections, entries, blocked, swipedIds);
    return out;
  }, [collections, entries, blocked, swipedIds]);
  // Library first: open on unrated finished shows, then the watchlist, else For you — decided once the library has loaded.
  const mode: Mode = picked ?? (hydrated ? defaultMode({ rate: sources.rate.length, watchlist: sources.watchlist.length }) : 'discover');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const deck = decks[mode];

  // Snapshot the deck for a mode the first time it has cards (recs can arrive late).
  useEffect(() => {
    const cur = useSession.getState().decks[mode];
    const src = sources[mode];
    if ((!cur || (cur.items.length === 0 && cur.done.length === 0)) && (src.length || !cur)) {
      useSession.setState((s) => ({ decks: { ...s.decks, [mode]: { items: src, done: [] } } }));
    }
  }, [mode, sources]);

  const remaining = useMemo(() => remainingOf(deck, mode, entries, blocked), [deck, mode, entries, blocked]);
  const top = remaining[0];
  useAmbientShow(top?.show);

  const [flying, setFlying] = useState<Fly[]>([]);
  const [returning, setReturning] = useState<{ id: ShowId; dir: Dir }>();
  const [rateFor, setRateFor] = useState<{ key: number; item: Item }>();

  const stageRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const setVars = (vars: Record<string, number>) => {
    const st = stageRef.current;
    if (!st) return;
    for (const [k, v] of Object.entries(vars)) st.style.setProperty(k, String(v));
  };
  const clearVars = () => {
    setVars({ '--sr': 0, '--sl': 0, '--su': 0, '--sd': 0, '--lift': 0 });
    if (stageRef.current) delete stageRef.current.dataset.dir;
  };

  /* ── committing a swipe ── */
  const commit = useCallback(
    (dir: Dir, from: Pose = { x: 0, y: 0, rot: 0 }) => {
      const s = useSession.getState();
      const m = modeRef.current;
      const d = s.decks[m];
      const lib = useLibrary.getState();
      const item = remainingOf(d, m, lib.entries, lib.blocked)[0];
      if (!d || !item) return;
      const { show } = item;
      const snap = takeSnap(show.id);
      const key = logSeq++;

      trackToasts(() => {
        if (m === 'rate') useLibrary.getState().rate(show.id, RATE_FOR[dir]);
        else if (m === 'watchlist') {
          if (dir === 'right') actions.setStatus(show, 'watching');
          else if (dir === 'left') actions.remove(show);
          else if (dir === 'up') actions.setStatus(show, 'completed');
        } else if (dir === 'right') actions.watchlist(show);
        else if (dir === 'left') actions.notInterested(show);
        else if (dir === 'up') actions.setStatus(show, 'completed');
      });

      useSession.setState((st) => ({
        mode: m, // swiping commits to this deck, so the library-first default can't switch under you
        decks: { ...st.decks, [m]: { items: d.items, done: [...d.done, show.id] } },
        log: [...st.log, { key, item, dir, mode: m, rating: m === 'rate' ? RATE_FOR[dir] : undefined, snap }],
      }));
      setFlying((f) => [...f.slice(-4), { key, item, dir, mode: m, from }]);
      setReturning(undefined);
      setRateFor(m !== 'rate' && dir === 'up' ? { key, item } : undefined);
      clearVars();
    },
    [actions],
  );

  const undo = useCallback(() => {
    const s = useSession.getState();
    const last = s.log[s.log.length - 1];
    if (!last) return;
    const id = last.item.show.id;
    trackToasts(() => restoreSnap(id, last.snap));
    const d = s.decks[last.mode];
    useSession.setState((st) => ({
      mode: last.mode,
      log: st.log.slice(0, -1),
      decks: d ? { ...st.decks, [last.mode]: { items: d.items, done: d.done.filter((x) => x !== id) } } : st.decks,
    }));
    setFlying((f) => f.filter((x) => x.item.show.id !== id));
    setReturning({ id, dir: last.dir });
    setRateFor(undefined);
  }, []);

  const open = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      remember(item.show);
      nav(showPath(item.show.id));
    },
    [nav],
  );

  const setMode = (m: Mode) => {
    setRateFor(undefined);
    setReturning(undefined);
    useSession.setState({ mode: m });
  };
  const deal = (m: Mode = mode) => {
    const src = buildDeck(m, collections, useLibrary.getState().entries, useLibrary.getState().blocked, swipedIds);
    useSession.setState((s) => ({ mode: m, decks: { ...s.decks, [m]: { items: src, done: [] } } }));
    setRateFor(undefined);
  };

  /* ── pointer drag ── */
  const drag = useRef<{
    id: number;
    x0: number;
    y0: number;
    lx: number;
    ly: number;
    lt: number;
    vx: number;
    vy: number;
    w: number;
    h: number;
    low: boolean;
    moved: boolean;
    pose: Pose;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      lt: e.timeStamp,
      vx: 0,
      vy: 0,
      w: r.width,
      h: r.height,
      low: e.clientY - r.top > r.height * 0.55,
      moved: false,
      pose: { x: 0, y: 0, rot: 0 },
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    if (!g.moved) {
      g.moved = true;
      stageRef.current?.setAttribute('data-drag', '');
      setRateFor(undefined);
    }
    const dt = Math.max(1, e.timeStamp - g.lt);
    g.vx = g.vx * 0.3 + ((e.clientX - g.lx) / dt) * 0.7;
    g.vy = g.vy * 0.3 + ((e.clientY - g.ly) / dt) * 0.7;
    g.lx = e.clientX;
    g.ly = e.clientY;
    g.lt = e.timeStamp;
    g.pose = { x: dx, y: dy, rot: tiltFor(dx, g.w, g.low) };
    if (bodyRef.current) bodyRef.current.style.transform = tf(g.pose);
    const { dir, p } = dragProgress(dx, dy, g.w, g.h);
    if (stageRef.current) stageRef.current.dataset.dir = dir ?? '';
    const ease = Math.min(1, p * 1.15);
    setVars({
      '--sr': dir === 'right' ? ease : 0,
      '--sl': dir === 'left' ? ease : 0,
      '--su': dir === 'up' ? ease : 0,
      '--sd': dir === 'down' ? ease : 0,
      '--lift': Math.min(1, Math.hypot(dx / (g.w * H_COMMIT), dy / (g.h * V_COMMIT))),
    });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = drag.current;
    if (!g || e.pointerId !== g.id) return;
    drag.current = null;
    stageRef.current?.removeAttribute('data-drag');
    if (!g.moved) {
      if (!cancelled) open(top);
      return;
    }
    // stale velocity if the pointer rested before release
    const idle = e.timeStamp - g.lt > 90;
    const dir = cancelled ? null : decideSwipe(g.pose.x, g.pose.y, idle ? 0 : g.vx, idle ? 0 : g.vy, g.w, g.h);
    if (dir) commit(dir, g.pose);
    else {
      if (bodyRef.current) bodyRef.current.style.transform = '';
      clearVars();
    }
  };
  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, true),
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ') {
        e.preventDefault();
        open(top);
      }
    },
  };

  /* ── keyboard ── */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"], .menu')) return;
      if (document.querySelector('.overlay, .palette, .modal')) return;
      const keyDir: Record<string, Dir> = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
      if (rateFor && /^[0-9]$/.test(e.key)) {
        const v = e.key === '0' ? 10 : Number(e.key);
        rateSeen(v);
      } else if (keyDir[e.key]) {
        if (t.closest('.swipe-rate__chips')) return; // don't swipe away while picking a rating
        commit(keyDir[e.key]);
      } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') undo();
      else if (e.key === 'Enter') {
        if (t.closest('button, a') && !t.classList.contains('swipe-card__body')) return;
        open(top);
      } else if (e.key === 'Escape' && rateFor) setRateFor(undefined);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  /* ── "Seen it" quick rating ── */
  const rateSeen = (v: number | undefined) => {
    if (!rateFor) return;
    useLibrary.getState().rate(rateFor.item.show.id, v);
    useSession.setState((s) => ({ log: s.log.map((l) => (l.key === rateFor.key ? { ...l, rating: v } : l)) }));
    if (v != null) {
      const k = rateFor.key;
      setTimeout(() => setRateFor((r) => (r?.key === k ? undefined : r)), 900);
    }
  };

  // Phones scroll the deck switcher: keep the active deck in view and drop the edge fade at the end.
  useEffect(() => {
    const seg = segRef.current;
    if (!seg) return;
    const on = seg.querySelector<HTMLElement>('button.on');
    if (on && seg.scrollWidth > seg.clientWidth) {
      const a = on.getBoundingClientRect();
      const box = seg.getBoundingClientRect();
      const pad = 28; // room for the edge fade
      const delta = a.left < box.left ? a.left - box.left - pad : a.right > box.right - pad ? a.right - box.right + pad : 0;
      if (delta) seg.scrollTo({ left: seg.scrollLeft + delta, behavior: reduced ? 'auto' : 'smooth' });
    }
    markSegEnd(seg);
  }, [mode, reduced]);

  /* ── counts ── */
  const tally = summarize(log);
  const count = (k: string) => tally.find((t) => t.label === k)?.v ?? 0;
  const counterKey = mode === 'rate' ? 'rated' : mode === 'watchlist' ? 'started' : 'saved';
  const isLib = LIBRARY_MODES.includes(mode);
  const loading = !remaining.length && !deck?.done.length && (!hydrated || (!isLib && recs.stage !== 'ready' && recs.stage !== 'error'));
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const countFor = (m: Mode) => {
    const d = decks[m];
    return d ? remainingOf(d, m, entries, blocked).length : sources[m].length;
  };
  const visible = remaining.slice(0, 4);
  // Where to go when this deck is done: the next deck (library first) that still has cards, else For you.
  const nextDeck = (() => {
    const pick = MODES.find((m) => m.id !== mode && countFor(m.id) > 0) ?? (mode !== 'discover' ? MODES.find((m) => m.id === 'discover') : undefined);
    return pick ? { id: pick.id, label: pick.label, n: countFor(pick.id) } : undefined;
  })();
  const done = !!deck && !remaining.length && !loading;

  return (
    <div className={`swipe ${reduceFx ? 'swipe--lowfx' : ''}`} data-mode={mode}>
      <header className="swipe-head">
        <div className="swipe-head__title">
          <h1>Swipe deck</h1>
          <p>Swipe right to save, left to skip — rate fast</p>
        </div>
        <div className="seg swipe-modes" role="tablist" aria-label="Deck" ref={segRef} onScroll={(e) => markSegEnd(e.currentTarget)}>
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={m.id === mode} className={m.id === mode ? 'on' : ''} onClick={() => setMode(m.id)} title={m.blurb}>
              <span className="swipe-modes__long">{m.label}</span>
              <span className="swipe-modes__short">{m.short}</span>
              <span className="n">{countFor(m.id)}</span>
            </button>
          ))}
        </div>
        <div className="swipe-counter" aria-live="polite">
          <b>{remaining.length}</b> left · <b>{count(counterKey)}</b> {counterKey} this session
        </div>
      </header>

      <div className="swipe-body">
        <aside className="swipe-legend panel panel--pad" aria-label="Controls">
          <div className="label">{modeInfo.label}</div>
          <p className="swipe-legend__blurb">{modeInfo.blurb}</p>
          <ul>
            {(['right', 'left', 'up', 'down'] as Dir[]).map((d) => {
              const m = dirMeta(mode, d);
              const K = m.key;
              return (
                <li key={d} className={`tone-${m.tone}`}>
                  <kbd>
                    <K size={14} aria-label={`${d} arrow`} />
                  </kbd>
                  <span>{m.stamp}</span>
                </li>
              );
            })}
            <li>
              <kbd>Enter</kbd>
              <span>Open show page</span>
            </li>
            <li>
              <kbd>Z</kbd>
              <span>Undo last swipe</span>
            </li>
          </ul>
          <p className="hint">Drag the card with your mouse or finger — fling it to decide.</p>
        </aside>

        <section className="swipe-stage" ref={stageRef} aria-label="Card deck">
          <div className="swipe-stack">
            {loading && (
              <div className="swipe-empty">
                <div className="spinner" />
                <p className="hint">Dealing your cards…</p>
              </div>
            )}
            {done && <EmptyDeck mode={mode} log={log} available={sources[mode].length} hadCards={!!deck?.items.length} onDeal={() => deal()} next={nextDeck} onNext={() => (nextDeck ? setMode(nextDeck.id) : nav('/discover'))} />}
            {[...visible].reverse().map((it) => {
              const depth = visible.indexOf(it);
              return (
                <StackCard
                  key={`${mode}:${it.show.id}`}
                  item={it}
                  depth={depth}
                  mode={mode}
                  reduced={reduced}
                  returnFrom={returning?.id === it.show.id && depth === 0 ? returning.dir : undefined}
                  bodyRef={depth === 0 ? bodyRef : undefined}
                  handlers={depth === 0 ? handlers : undefined}
                />
              );
            })}
            {flying.map((f) => (
              <FlyingCard key={f.key} fly={f} reduced={reduced} onDone={(k) => setFlying((list) => list.filter((x) => x.key !== k))} />
            ))}
          </div>

          {rateFor && (
            <RatePop
              key={rateFor.key}
              title={rateFor.item.show.title}
              value={log.find((l) => l.key === rateFor.key)?.rating}
              onRate={rateSeen}
              onClose={() => setRateFor(undefined)}
            />
          )}

          <div className="swipe-controls" role="toolbar" aria-label="Swipe actions">
            <button className="swipe-btn swipe-btn--small" data-dir="undo" onClick={undo} disabled={!log.length} aria-label="Undo last swipe (Z)" title="Undo (Z / Backspace)">
              <span className="swipe-btn__disc">
                <RotateCcw size={18} />
              </span>
              <span className="swipe-btn__label">Undo</span>
            </button>
            {(['left', 'down', 'up', 'right'] as Dir[]).map((d) => {
              const m = dirMeta(mode, d);
              const Icon = m.icon;
              const big = d === 'left' || d === 'right';
              return (
                <button
                  key={d}
                  data-dir={d}
                  className={`swipe-btn tone-${m.tone} ${big ? 'swipe-btn--big' : ''}`}
                  onClick={() => commit(d)}
                  disabled={!top}
                  aria-label={m.stamp}
                  title={`${m.stamp} (${d} arrow)`}
                >
                  <span className="swipe-btn__disc">
                    <Icon size={big ? 26 : 20} strokeWidth={2.4} />
                    {m.badge && <span className="swipe-btn__badge">{m.badge}</span>}
                  </span>
                  <span className="swipe-btn__label">{m.button}</span>
                </button>
              );
            })}
            <button className="swipe-btn swipe-btn--small" data-dir="open" onClick={() => open(top)} disabled={!top} aria-label="Open show page (Enter)" title="Open show page (Enter)">
              <span className="swipe-btn__disc">
                <Info size={18} />
              </span>
              <span className="swipe-btn__label">Details</span>
            </button>
          </div>
        </section>

        <SessionPanel log={log} onOpen={open} />
      </div>
    </div>
  );
}

function markSegEnd(seg: HTMLElement) {
  seg.classList.toggle('is-end', seg.scrollLeft + seg.clientWidth >= seg.scrollWidth - 2);
}

/* ───────────────────────── quick rating after "Seen it" ───────────────────────── */

function RatePop({ title, value, onRate, onClose }: { title: string; value?: number; onRate: (v: number | undefined) => void; onClose: () => void }) {
  const [hold, setHold] = useState(false);
  const [round, setRound] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (hold) return;
    const t = setTimeout(() => close.current(), 4500);
    return () => clearTimeout(t);
  }, [hold, round]);
  return (
    <div
      className="swipe-rate"
      role="dialog"
      aria-label={`Rate ${title}`}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => {
        setHold(false);
        setRound((r) => r + 1);
      }}
      onFocus={() => setHold(true)}
      onBlur={() => {
        setHold(false);
        setRound((r) => r + 1);
      }}
    >
      <div className="swipe-rate__head">
        <Eye size={16} aria-hidden />
        <span>
          Marked <b>{title}</b> as watched. {value != null ? `Rated ${value}/10.` : 'How was it?'}
        </span>
        <button className="swipe-rate__close" onClick={onClose} aria-label="Close rating">
          <X size={18} />
        </button>
      </div>
      <div className="swipe-rate__chips" role="radiogroup" aria-label="Your rating">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={`${value != null && n <= value ? 'on' : ''} ${value === n ? 'is-value' : ''}`}
            onClick={() => onRate(value === n ? undefined : n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="swipe-rate__hint">Press 1–9, 0 = 10</div>
      {!hold && <div key={round} className="swipe-rate__timer" aria-hidden />}
    </div>
  );
}

/* ───────────────────────── session list + empty state ───────────────────────── */

function outcomeIcon(l: LogEntry): LucideIcon {
  if (l.mode === 'rate' || l.mode === 'watchlist') return dirMeta(l.mode, l.dir).icon;
  return l.dir === 'right' ? Bookmark : dirMeta(l.mode, l.dir).icon;
}
function toneOf(l: LogEntry) {
  return dirMeta(l.mode, l.dir).tone;
}

function summarize(log: LogEntry[]) {
  const n = (f: (l: LogEntry) => boolean) => log.filter(f).length;
  const recMode = (l: LogEntry) => l.mode !== 'rate' && l.mode !== 'watchlist';
  return [
    { label: 'started', v: n((l) => l.mode === 'watchlist' && l.dir === 'right'), tone: 'ok' },
    { label: 'saved', v: n((l) => recMode(l) && l.dir === 'right'), tone: 'ok' },
    { label: 'seen', v: n((l) => l.mode !== 'rate' && l.dir === 'up'), tone: 'accent' },
    { label: 'rated', v: n((l) => l.rating != null), tone: 'accent' },
    { label: 'removed', v: n((l) => l.mode === 'watchlist' && l.dir === 'left'), tone: 'danger' },
    { label: 'passed', v: n((l) => recMode(l) && l.dir === 'left'), tone: 'danger' },
    { label: 'kept', v: n((l) => l.mode === 'watchlist' && l.dir === 'down'), tone: 'dim' },
    { label: 'skipped', v: n((l) => recMode(l) && l.dir === 'down'), tone: 'dim' },
  ].filter((x) => x.v > 0);
}

function SessionPanel({ log, onOpen }: { log: LogEntry[]; onOpen: (item: Item) => void }) {
  const stats = summarize(log);
  return (
    <aside className="swipe-session panel" aria-label="This session">
      <div className="swipe-session__head">
        <h2>This session</h2>
        <span className="tag">{log.length} swiped</span>
      </div>
      {stats.length > 0 && (
        <div className="swipe-session__stats">
          {stats.map((s) => (
            <span key={s.label} className={`tone-${s.tone}`}>
              <b>{s.v}</b> {s.label}
            </span>
          ))}
        </div>
      )}
      {log.length === 0 ? (
        <p className="hint swipe-session__empty">Your swipes land here — tap one to open it, or press Z to undo the last.</p>
      ) : (
        <ol className="swipe-session__list">
          {[...log].reverse().map((l) => {
            const Icon = outcomeIcon(l);
            return (
              <li key={l.key}>
                <button onClick={() => onOpen(l.item)}>
                  <span className="swipe-session__thumb">
                    <Poster show={l.item.show} />
                  </span>
                  <span className="swipe-session__main">
                    <span className="swipe-session__title">{l.item.show.title}</span>
                    <span className={`swipe-session__out tone-${toneOf(l)}`}>
                      <Icon size={13} aria-hidden /> {outcomeLabel(l.mode, l.dir, l.rating)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function EmptyDeck({
  mode,
  log,
  available,
  hadCards,
  next,
  onDeal,
  onNext,
}: {
  mode: Mode;
  log: LogEntry[];
  available: number;
  hadCards: boolean;
  /** The deck to suggest next (undefined = leave for the Discover page). */
  next?: { id: Mode; label: string; n: number };
  onDeal: () => void;
  onNext: () => void;
}) {
  const stats = summarize(log);
  const swiped = log.filter((l) => l.mode === mode).length;
  const cleared = hadCards && swiped > 0;
  const title = cleared
    ? mode === 'rate'
      ? 'All rated!'
      : mode === 'watchlist'
        ? 'Watchlist sorted!'
        : 'Deck cleared!'
    : mode === 'rate'
      ? 'Nothing to rate'
      : mode === 'watchlist'
        ? 'Watchlist is empty'
        : 'No cards here yet';
  const sub = cleared
    ? `You went through ${swiped} card${swiped === 1 ? '' : 's'} in ${MODES.find((m) => m.id === mode)!.label}.`
    : mode === 'rate'
      ? 'Every show you finished already has a rating. Nice.'
      : mode === 'watchlist'
        ? 'Swipe right in For you to save shows you want to watch.'
        : mode === 'discover'
          ? 'Add a few shows you love and recommendations will start flowing.'
          : 'This shelf needs a few more ratings to fill up — try For you.';
  return (
    <div className={`swipe-empty ${cleared ? 'is-party' : ''}`}>
      <div className="swipe-empty__icon" aria-hidden>
        {cleared && (
          <div className="swipe-confetti">
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} style={{ '--k': i } as CSSProperties} />
            ))}
          </div>
        )}
        <PartyPopper size={34} />
      </div>
      <h2>{title}</h2>
      <p>{sub}</p>
      {stats.length > 0 && (
        <div className="swipe-session__stats swipe-empty__stats">
          {stats.map((s) => (
            <span key={s.label} className={`tone-${s.tone}`}>
              <b>{s.v}</b> {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="swipe-empty__actions">
        {available > 0 && (
          <button className="btn btn--primary" onClick={onDeal}>
            <RefreshCw size={16} /> Deal {available} more
          </button>
        )}
        <button className={`btn ${available > 0 ? 'btn--ghost' : 'btn--primary'}`} onClick={onNext}>
          <Sparkles size={16} /> {next ? `Go to ${next.label}${next.n ? ` · ${next.n}` : ''}` : 'Browse Discover'}
        </button>
      </div>
    </div>
  );
}
