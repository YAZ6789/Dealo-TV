import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Crown,
  Download,
  Flame,
  Heart,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Star,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { computeWrapped, defaultWrappedYear, monthName, wrappedText, wrappedYears, type PersonaId, type WrappedData } from '../stats/wrapped';
import { GENRE_LABELS } from '../lib/genres';
import { Poster } from '../components/Poster';
import { Empty } from '../components/Empty';
import { toast } from '../components/toast';
import type { GenreKey, ShowSummary } from '../types';

/* ───────────── small helpers ───────────── */

const SLIDE_MS = 6000;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const genreLabel = (g: GenreKey) => GENRE_LABELS[g] ?? g;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
let langNames: Intl.DisplayNames | undefined;
const langName = (code: string) => {
  try {
    langNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
    return langNames.of(code) ?? code;
  } catch {
    return code;
  }
};

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

/** Number that counts up from 0 when it mounts (instant with reduced motion). */
function Count({ value, dur = 1500, delay = 0 }: { value: number; dur?: number; delay?: number }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setN(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - t0) / dur));
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, dur, delay, reduced]);
  return (
    <>
      <span aria-hidden>{n.toLocaleString()}</span>
      <span className="sr-only">{value.toLocaleString()}</span>
    </>
  );
}

function WPoster({ show, className = '', style, badge }: { show: ShowSummary; className?: string; style?: CSSProperties; badge?: ReactNode }) {
  return (
    <div className={`wr-poster ${className}`} style={style}>
      <Poster show={show} eager />
      {badge && <span className="wr-poster__badge">{badge}</span>}
    </div>
  );
}

const PERSONA_ICON: Record<PersonaId, typeof Moon> = {
  'night-owl': Moon,
  binger: Zap,
  completionist: Trophy,
  critic: Star,
  explorer: Compass,
  loyalist: Heart,
  sampler: Shuffle,
  fresh: Sparkles,
};

/* ───────────── slides ───────────── */

interface SlideDef {
  id: string;
  label: string;
  tone: number;
  ms?: number;
  render: () => ReactNode;
}

const FLY = [
  { l: 6, t: 14, r: -9, s: 0.92, fx: -260, fy: -80 },
  { l: 30, t: 2, r: 4, s: 1.04, fx: -40, fy: -320 },
  { l: 55, t: 10, r: 10, s: 0.96, fx: 260, fy: -200 },
  { l: 72, t: 38, r: -5, s: 0.88, fx: 340, fy: 60 },
  { l: 14, t: 48, r: 7, s: 0.9, fx: -320, fy: 200 },
  { l: 40, t: 40, r: -3, s: 1.1, fx: 0, fy: 360 },
  { l: 62, t: 64, r: 6, s: 0.84, fx: 280, fy: 320 },
];

function PosterCloud({ shows }: { shows: ShowSummary[] }) {
  return (
    <div className="wr-cloud" aria-hidden>
      {shows.slice(0, FLY.length).map((s, i) => {
        const f = FLY[i];
        return (
          <WPoster
            key={s.id}
            show={s}
            className="wr-fly"
            style={{ left: `${f.l}%`, top: `${f.t}%`, '--r': `${f.r}deg`, '--s': f.s, '--fx': `${f.fx}px`, '--fy': `${f.fy}px`, '--i': i, zIndex: i === 5 ? 9 : i } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

function HourClock({ hours, nightShare }: { hours: number[]; nightShare: number }) {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const c = 150;
  const r0 = 62;
  return (
    <figure className="wr-clock">
      <svg viewBox="-34 -22 368 344" role="img" aria-label={`Episodes by hour of day. Peak at ${hourLabel(peak)}; ${pct(nightShare)} between 10pm and 4am.`}>
        <circle cx={c} cy={c} r={r0 - 10} className="wr-clock__face" />
        <circle cx={c} cy={c} r={r0 + 82} className="wr-clock__ring" />
        {hours.map((n, h) => {
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
          const len = n ? 8 + (n / max) * 74 : 2;
          const night = h >= 22 || h < 4;
          return (
            <line
              key={h}
              className={`wr-clock__ray${night ? ' is-night' : ''}${h === peak ? ' is-peak' : ''}`}
              style={{ '--i': h } as CSSProperties}
              x1={c + Math.cos(a) * r0}
              y1={c + Math.sin(a) * r0}
              x2={c + Math.cos(a) * (r0 + len)}
              y2={c + Math.sin(a) * (r0 + len)}
            >
              <title>{`${hourLabel(h)}: ${n} episodes`}</title>
            </line>
          );
        })}
        {[0, 6, 12, 18].map((h) => {
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
          return (
            <text key={h} x={c + Math.cos(a) * (r0 + 100)} y={c + Math.sin(a) * (r0 + 100) + 4} textAnchor="middle" className="wr-clock__tick">
              {['midnight', '6am', 'noon', '6pm'][h / 6]}
            </text>
          );
        })}
        <text x={c} y={c - 4} textAnchor="middle" className="wr-clock__peak">
          {hourLabel(peak)}
        </text>
        <text x={c} y={c + 18} textAnchor="middle" className="wr-clock__cap">
          peak hour
        </text>
      </svg>
      <figcaption>
        <span className="wr-swatch wr-swatch--night" />
        <span>
          10pm–4am: <b>{pct(nightShare)}</b> of episodes
        </span>
      </figcaption>
    </figure>
  );
}

function Bars({ rows, max }: { rows: { key: string; label: ReactNode; value: number; text: string; lead?: ReactNode }[]; max: number }) {
  return (
    <ol className="wr-bars">
      {rows.map((r, i) => (
        <li key={r.key} className="wr-bars__row" style={{ '--i': i } as CSSProperties}>
          {r.lead}
          <div className="wr-bars__main">
            <div className="wr-bars__head">
              <span className="wr-bars__label">{r.label}</span>
              <span className="wr-bars__value">{r.text}</span>
            </div>
            <div className="wr-bars__track">
              <div className="wr-bars__fill" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Columns({ values, labels, highlight, caption, small }: { values: number[]; labels: string[]; highlight: number; caption: string; small?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <figure className={`wr-cols${small ? ' wr-cols--sm' : ''}`}>
      <figcaption className="wr-cols__cap">{caption}</figcaption>
      <div className="wr-cols__plot" role="img" aria-label={`${caption}: ${values.map((v, i) => `${labels[i]} ${v}`).join(', ')}`}>
        {values.map((v, i) => (
          <div key={i} className={`wr-cols__col${i === highlight ? ' is-hi' : ''}`} title={`${labels[i]}: ${v} episodes`} style={{ '--i': i } as CSSProperties}>
            <div className="wr-cols__bar" style={{ height: `${v ? Math.max(4, (v / max) * 100) : 1.5}%` }}>
              {i === highlight && <span className="wr-cols__val">{v}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="wr-cols__axis" aria-hidden>
        {labels.map((l, i) => (
          <span key={i} className={i === highlight ? 'is-hi' : ''}>
            {small ? l.slice(0, 2) : l.slice(0, 1)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function personaEvidence(w: WrappedData): string[] {
  const top = w.topShows[0];
  const out: string[] = [];
  switch (w.persona.id) {
    case 'night-owl':
      out.push(`${pct(w.nightShare)} of episodes after 10pm`);
      break;
    case 'binger':
      out.push(`${plural(w.bingeDays, 'day')} with 5+ episodes`);
      if (w.biggestDay) out.push(`Record: ${w.biggestDay.episodes} in a day`);
      break;
    case 'completionist':
      out.push(`${plural(w.finished.length, 'show')} finished`);
      break;
    case 'critic':
      out.push(`${plural(w.ratedCount, 'show')} rated`);
      break;
    case 'explorer':
      out.push(`${plural(w.genreCount, 'genre')}`);
      if (w.languages.length > 1) out.push(`${plural(w.languages.length, 'language')}`);
      break;
    case 'loyalist':
      if (top && w.episodes) out.push(`${pct(top.episodes / w.episodes)} on ${top.entry.show.title}`);
      break;
  }
  if (w.episodes) out.push(`${plural(w.showCount, 'show')} · ${w.hours.toLocaleString()} hrs`);
  return out.slice(0, 3);
}

function buildSlides(w: WrappedData, onReplay: () => void, years: number[], onYear: (y: number) => void): SlideDef[] {
  const s: SlideDef[] = [];
  const est = w.source === 'completed';
  const cloud = [...new Map([...w.topShows.map((t) => t.entry), ...w.finished, ...w.started].map((e) => [e.id, e.show])).values()];

  s.push({
    id: 'intro',
    label: 'Intro',
    tone: 0,
    render: () => (
      <>
        <div className="wr-copy">
          <p className="wr-kicker">Dealo Wrapped</p>
          <h1 className="wr-year" aria-label={String(w.year)}>
            {String(w.year)
              .split('')
              .map((d, i) => (
                <span key={i} style={{ '--i': i } as CSSProperties} aria-hidden>
                  {d}
                </span>
              ))}
          </h1>
          <p className="wr-title">Your year in TV</p>
          <p className="wr-sub">
            {w.source === 'empty'
              ? 'Nothing logged this year yet — but every story starts somewhere.'
              : est
                ? `${plural(w.finished.length, 'show')} finished. Let’s rewind.`
                : `${plural(w.episodes, 'episode')}. ${plural(w.showCount, 'show')}. Let’s rewind.`}
          </p>
          <p className="wr-hint">
            <span className="wr-hint--touch">Tap the right side for next · hold to pause</span>
            <span className="wr-hint--keys">
              <kbd>→</kbd> next · <kbd>Space</kbd> pause · <kbd>Esc</kbd> exit
            </span>
          </p>
        </div>
        {cloud.length > 0 && (
          <div className="wr-visual">
            <PosterCloud shows={cloud} />
          </div>
        )}
      </>
    ),
  });

  if (w.source === 'empty') {
    s.push(summarySlide(w, onReplay, years, onYear));
    return s;
  }

  const days = w.hours / 24;
  s.push({
    id: 'time',
    label: 'Time watched',
    tone: 1,
    render: () => (
      <>
        <div className="wr-copy">
          <p className="wr-kicker">Time on screen</p>
          <p className="wr-big">
            {est && <span className="wr-big__approx">≈</span>}
            <Count value={w.hours} />
            <span className="wr-big__unit">hours</span>
          </p>
          <p className="wr-sub">
            {plural(w.episodes, 'episode')} across {plural(w.showCount, 'show')}
            {w.activeDays ? ` on ${plural(w.activeDays, 'day')}` : ''}.
          </p>
          <p className="wr-line">
            That’s <b>{days >= 1 ? `${days.toFixed(1)} days` : `${Math.round(w.minutes)} minutes`}</b> of non-stop TV.
          </p>
          {est && <p className="wr-note">Estimated from the shows you finished — tick episodes to get exact numbers next year.</p>}
        </div>
        {w.source === 'activity' && (
          <div className="wr-visual">
            <HourClock hours={w.hours24} nightShare={w.nightShare} />
          </div>
        )}
      </>
    ),
  });

  const top = w.topShows[0];
  if (top) {
    const rest = w.topShows.slice(1);
    s.push({
      id: 'top',
      label: 'Top shows',
      tone: 2,
      ms: 7500,
      render: () => (
        <>
          <div className="wr-copy">
            <p className="wr-kicker">Your #1 show</p>
            <p className="wr-headline">{top.entry.show.title}</p>
            <p className="wr-sub">
              <b>{plural(top.episodes, 'episode')}</b>
              {w.episodes > top.episodes ? ` — ${pct(top.episodes / w.episodes)} of everything you watched.` : '.'}
            </p>
            {rest.length > 0 && (
              <Bars
                max={top.episodes}
                rows={rest.map((t, i) => ({
                  key: t.entry.id,
                  lead: <span className="wr-rank">{i + 2}</span>,
                  label: t.entry.show.title,
                  value: t.episodes,
                  text: `${t.episodes} ep`,
                }))}
              />
            )}
          </div>
          <div className="wr-visual">
            <WPoster show={top.entry.show} className="wr-hero-poster wr-fly" style={{ '--fx': '0px', '--fy': '120px', '--r': '-3deg', '--s': 1 } as CSSProperties} badge={<><Crown size={14} /> #1</>} />
          </div>
        </>
      ),
    });
  }

  if (w.topGenres.length) {
    const g = w.topGenres[0];
    const known = w.languages.length;
    s.push({
      id: 'genres',
      label: 'Genres',
      tone: 3,
      render: () => (
        <>
          <div className="wr-copy">
            <p className="wr-kicker">Your genres</p>
            <p className="wr-headline">{genreLabel(g.genre)}</p>
            <p className="wr-sub">
              <b>{pct(g.share)}</b> of your episodes had {genreLabel(g.genre).toLowerCase()} in them.
            </p>
            {known > 0 && (
              <div className="wr-chips">
                {w.nonEnglishCount > 0 ? (
                  <span className="wr-chip">
                    {pct(w.nonEnglishShare)} not in English · {w.languages.filter((l) => l !== 'en').slice(0, 3).map(langName).join(', ')}
                  </span>
                ) : (
                  <span className="wr-chip">All English-language this year</span>
                )}
                <span className="wr-chip">{plural(w.genreCount, 'genre')} explored</span>
              </div>
            )}
          </div>
          <div className="wr-visual">
            <Bars
              max={w.topGenres[0].episodes}
              rows={w.topGenres.map((t, i) => ({
                key: t.genre,
                lead: <span className="wr-rank">{i + 1}</span>,
                label: genreLabel(t.genre),
                value: t.episodes,
                text: `${t.episodes} ep · ${pct(t.share)}`,
              }))}
            />
          </div>
        </>
      ),
    });
  }

  if (w.busiestMonth && w.months.filter(Boolean).length > 1) {
    const bm = w.busiestMonth;
    const fd = w.favouriteWeekday;
    s.push({
      id: 'rhythm',
      label: 'Rhythm',
      tone: 0,
      render: () => (
        <>
          <div className="wr-copy">
            <p className="wr-kicker">Your rhythm</p>
            <p className="wr-headline">{monthName(bm.month)}</p>
            <p className="wr-sub">
              Your busiest month — <b>{plural(bm.episodes, 'episode')}</b>
              {est ? ' from the shows you wrapped up.' : '.'}
            </p>
            {fd && (
              <p className="wr-line">
                <b>{DOW[fd.day]}s</b> were TV night: {plural(fd.episodes, 'episode')}.
              </p>
            )}
          </div>
          <div className="wr-visual wr-visual--stack">
            <Columns values={w.months} labels={Array.from({ length: 12 }, (_, i) => monthName(i))} highlight={bm.month} caption="Episodes per month" />
            {fd && <Columns small values={w.weekdays} labels={DOW} highlight={fd.day} caption="Episodes by weekday" />}
          </div>
        </>
      ),
    });
  }

  if (w.biggestDay && w.biggestDay.episodes > 1) {
    const b = w.biggestDay;
    const st = w.longestStreak;
    const tiles = Math.min(b.episodes, 30);
    s.push({
      id: 'binge',
      label: 'Binge',
      tone: 1,
      render: () => (
        <>
          <div className="wr-copy">
            <p className="wr-kicker">Biggest binge</p>
            <p className="wr-big">
              <Count value={b.episodes} dur={1100} />
              <span className="wr-big__unit">episodes in one day</span>
            </p>
            <p className="wr-sub">
              {shortDate(b.day)}
              {b.entry ? (
                <>
                  {' '}
                  — {b.showCount > 1 ? 'mostly ' : 'all '}
                  <b>{b.entry.show.title}</b>.
                </>
              ) : (
                '.'
              )}
            </p>
            <div className="wr-chips">
              {st && st.days > 1 && (
                <span className="wr-chip">
                  <Flame size={15} /> {st.days}-day streak · {shortDate(st.from)} – {shortDate(st.to)}
                </span>
              )}
              {w.bingeDays > 0 && <span className="wr-chip">{plural(w.bingeDays, 'day')} with 5+ episodes</span>}
            </div>
          </div>
          <div className="wr-visual wr-binge">
            {b.entry && <WPoster show={b.entry.show} className="wr-binge__poster wr-fly" style={{ '--fx': '-160px', '--fy': '0px', '--r': '-4deg', '--s': 1 } as CSSProperties} />}
            <div className="wr-tiles" aria-hidden style={{ '--cols': tiles <= 4 ? tiles : tiles <= 9 ? 3 : tiles <= 16 ? 4 : 6 } as CSSProperties}>
              {Array.from({ length: tiles }, (_, i) => (
                <span key={i} className="wr-tile" style={{ '--i': i } as CSSProperties}>
                  {i + 1}
                </span>
              ))}
              <span className="wr-tiles__cap">1 tile = 1 episode</span>
            </div>
          </div>
        </>
      ),
    });
  }

  if (w.started.length || w.finished.length) {
    const best = w.topRatedFinished;
    const shelf = [...w.finished].sort((a, b) => (b.id === best?.id ? 1 : 0) - (a.id === best?.id ? 1 : 0)).slice(0, 8);
    s.push({
      id: 'finishes',
      label: 'Starts and finishes',
      tone: 2,
      render: () => (
        <>
          <div className="wr-copy">
            <p className="wr-kicker">Starts &amp; finishes</p>
            <div className="wr-duo">
              <div>
                <p className="wr-duo__n">
                  <Count value={w.started.length} dur={900} />
                </p>
                <p className="wr-duo__l">shows started</p>
              </div>
              <div>
                <p className="wr-duo__n">
                  <Count value={w.finished.length} dur={900} delay={250} />
                </p>
                <p className="wr-duo__l">shows finished</p>
              </div>
            </div>
            {best ? (
              <p className="wr-sub">
                Highest-rated finish: <b>{best.show.title}</b> — {best.rating}/10.
              </p>
            ) : w.finished.length ? (
              <p className="wr-sub">Rate what you finish to crown a best show next time.</p>
            ) : (
              <p className="wr-sub">Nothing crossed the finish line yet — plenty in progress.</p>
            )}
          </div>
          {shelf.length > 0 && (
            <div className="wr-visual">
              <div className={`wr-shelf wr-shelf--${Math.min(shelf.length, 8)}`}>
                {shelf.map((e, i) => (
                  <WPoster
                    key={e.id}
                    show={e.show}
                    className={`wr-fly${e.id === best?.id ? ' is-best' : ''}`}
                    style={{ '--fx': `${(i % 4) * 60 - 90}px`, '--fy': '260px', '--r': '0deg', '--s': 1, '--i': i } as CSSProperties}
                    badge={e.id === best?.id ? <><Trophy size={13} /> {best.rating}/10</> : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ),
    });
  }

  if (w.firstShow && w.lastShow && w.showCount > 1) {
    const f = w.firstShow;
    const l = w.lastShow;
    const same = f.entry.id === l.entry.id;
    const ongoing = w.year === new Date().getFullYear();
    s.push({
      id: 'bookends',
      label: 'First and last',
      tone: 3,
      render: () => (
        <>
          <div className="wr-copy">
            <p className="wr-kicker">Bookends</p>
            <p className="wr-statement">
              You opened {w.year} with <b>{f.entry.show.title}</b>
              {same ? ' — and you never really left it.' : <> and {ongoing ? 'most recently pressed play on' : 'closed it with'} <b>{l.entry.show.title}</b>.</>}
            </p>
            {est && <p className="wr-note">Based on when you finished each show.</p>}
          </div>
          <div className="wr-visual">
            <div className="wr-ends">
              <figure className="wr-ends__item">
                <WPoster show={f.entry.show} className="wr-fly" style={{ '--fx': '-200px', '--fy': '0px', '--r': '-5deg', '--s': 1 } as CSSProperties} />
                <figcaption>
                  <span className="wr-ends__tag">First</span> {shortDate(f.day)}
                </figcaption>
              </figure>
              <div className="wr-ends__line" aria-hidden>
                <span />
              </div>
              <figure className="wr-ends__item">
                <WPoster show={l.entry.show} className="wr-fly" style={{ '--fx': '200px', '--fy': '0px', '--r': '5deg', '--s': 1, '--i': 2 } as CSSProperties} />
                <figcaption>
                  <span className="wr-ends__tag">{ongoing ? 'Latest' : 'Last'}</span> {shortDate(l.day)}
                </figcaption>
              </figure>
            </div>
          </div>
        </>
      ),
    });
  }

  const Icon = PERSONA_ICON[w.persona.id];
  s.push({
    id: 'persona',
    label: 'Persona',
    tone: 4,
    ms: 7000,
    render: () => (
      <>
        <div className="wr-copy">
          <p className="wr-kicker">Your viewer persona</p>
          <p className="wr-youre">You’re</p>
          <p className="wr-headline wr-persona-name">{w.persona.name}</p>
          <p className="wr-sub">{w.persona.line}</p>
          <div className="wr-chips">
            {personaEvidence(w).map((t) => (
              <span key={t} className="wr-chip">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="wr-visual">
          <div className="wr-emblem" aria-hidden>
            <span className="wr-emblem__ring wr-emblem__ring--1" />
            <span className="wr-emblem__ring wr-emblem__ring--2" />
            <span className="wr-emblem__ring wr-emblem__ring--3" />
            <span className="wr-emblem__core">
              <Icon size={72} strokeWidth={1.5} />
            </span>
          </div>
        </div>
      </>
    ),
  });

  s.push(summarySlide(w, onReplay, years, onYear));
  return s;
}

function summarySlide(w: WrappedData, onReplay: () => void, years: number[], onYear: (y: number) => void): SlideDef {
  return {
    id: 'summary',
    label: 'Summary',
    tone: 5,
    render: () => <Summary w={w} onReplay={onReplay} years={years} onYear={onYear} />,
  };
}

function Summary({ w, onReplay, years, onYear }: { w: WrappedData; onReplay: () => void; years: number[]; onYear: (y: number) => void }) {
  const [busy, setBusy] = useState(false);
  const Icon = PERSONA_ICON[w.persona.id];
  const save = async () => {
    setBusy(true);
    try {
      const blob = await renderShareCard(w);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dealo-wrapped-${w.year}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Share card saved');
    } catch {
      toast('Couldn’t create the image');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const text = wrappedText(w, genreLabel);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Summary copied to clipboard');
  };
  const g = w.topGenres[0];
  return (
    <div className="wr-summary" data-no-tap>
      <article className="wr-card" aria-label={`Dealo Wrapped ${w.year} summary`}>
        <header className="wr-card__head">
          <span className="wr-kicker">Dealo Wrapped</span>
          <span className="wr-card__year">{w.year}</span>
        </header>
        <div className="wr-card__persona">
          <span className="wr-card__icon" aria-hidden>
            <Icon size={26} />
          </span>
          <div>
            <p className="wr-card__pname">{w.persona.name}</p>
            <p className="wr-card__pline">{w.persona.line}</p>
          </div>
        </div>
        <dl className="wr-card__kpis">
          <div>
            <dt>Hours</dt>
            <dd>
              {w.source === 'completed' ? '≈' : ''}
              {w.hours.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Episodes</dt>
            <dd>{w.episodes.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{w.finished.length}</dd>
          </div>
        </dl>
        {w.topShows.length > 0 && (
          <div className="wr-card__top">
            <p className="wr-card__label">Top shows</p>
            <ol>
              {w.topShows.slice(0, 3).map((t, i) => (
                <li key={t.entry.id}>
                  <span className="wr-rank">{i + 1}</span>
                  <WPoster show={t.entry.show} className="wr-card__thumb" />
                  <span className="wr-card__title">{t.entry.show.title}</span>
                  <span className="wr-card__ep">{t.episodes} ep</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <footer className="wr-card__foot">
          {g && (
            <span>
              Top genre <b>{genreLabel(g.genre)}</b>
            </span>
          )}
          {w.busiestMonth && (
            <span>
              Peak <b>{monthName(w.busiestMonth.month)}</b>
            </span>
          )}
        </footer>
      </article>
      <div className="wr-actions">
        <button className="btn btn--primary" onClick={save} disabled={busy}>
          <Download size={16} /> {busy ? 'Rendering…' : 'Save image'}
        </button>
        <button className="btn" onClick={copy}>
          <Copy size={16} /> Copy text summary
        </button>
        <button className="btn btn--ghost" onClick={onReplay}>
          <RotateCcw size={16} /> Replay
        </button>
        <Link className="btn btn--ghost" to="/stats">
          <BarChart3 size={16} /> <span className="wr-hide-xs">Back to&nbsp;</span>Stats
        </Link>
        {years.length > 1 && (
          <div className="wr-years" role="group" aria-label="Other years">
            {years.map((y) => (
              <button key={y} className={`chip${y === w.year ? ' chip--on' : ''}`} aria-pressed={y === w.year} onClick={() => onYear(y)}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── share card (Canvas 2D) ───────────── */

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Resolve skin tokens to concrete rgb() strings (works even when a token is a color-mix() or var()). */
function readTokens() {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const color = (v: string) => {
    probe.style.color = '';
    probe.style.color = `var(${v})`;
    return getComputedStyle(probe).color || '#888';
  };
  const cs = getComputedStyle(document.documentElement);
  const t = {
    bg: color('--bg'),
    bg2: color('--bg-2'),
    panel: color('--panel-solid'),
    border: color('--panel-border-strong'),
    text: color('--text'),
    dim: color('--text-dim'),
    faint: color('--text-faint'),
    accent: color('--accent'),
    accent2: color('--accent-2'),
    accent3: color('--accent-3'),
    ink: color('--accent-ink'),
    display: cs.getPropertyValue('--font-display').trim() || 'sans-serif',
    body: cs.getPropertyValue('--font-body').trim() || 'sans-serif',
    mono: cs.getPropertyValue('--font-mono').trim() || 'monospace',
    upper: cs.getPropertyValue('--title-transform').trim() === 'uppercase',
    weight: cs.getPropertyValue('--hero-weight').trim() || '800',
  };
  probe.remove();
  return t;
}

async function renderShareCard(w: WrappedData): Promise<Blob> {
  const t = readTokens();
  const W = 1080;
  const H = 1920;
  try {
    await Promise.all([document.fonts.load(`${t.weight} 100px ${t.display}`), document.fonts.load(`700 40px ${t.body}`), document.fonts.load(`500 30px ${t.mono}`)]);
  } catch {
    /* fonts are a nicety */
  }
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const up = (s: string) => (t.upper ? s.toUpperCase() : s);
  const spacing = (px: number) => {
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
  };
  const rr = (x: number, y: number, w2: number, h2: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w2, y, x + w2, y + h2, r);
    ctx.arcTo(x + w2, y + h2, x, y + h2, r);
    ctx.arcTo(x, y + h2, x, y, r);
    ctx.arcTo(x, y, x + w2, y, r);
    ctx.closePath();
  };
  const fit = (text: string, maxW: number) => {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
  };
  const wrap = (text: string, maxW: number, maxLines: number) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const keep = lines.slice(0, maxLines);
      keep[maxLines - 1] = fit(`${keep[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxW);
      return keep;
    }
    return lines;
  };

  // Background: base gradient, three soft glows, a faint grid.
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, t.bg);
  bgGrad.addColorStop(1, t.bg2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, c: string, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  };
  glow(900, 260, 760, t.accent, 0.32);
  glow(80, 1500, 820, t.accent2, 0.3);
  glow(700, 1100, 520, t.accent3, 0.14);
  ctx.strokeStyle = t.border;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 72) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const M = 84;
  ctx.textBaseline = 'alphabetic';

  // Header
  ctx.fillStyle = t.accent;
  ctx.font = `600 34px ${t.mono}`;
  spacing(6);
  ctx.fillText('DEALO WRAPPED', M, 150);
  ctx.fillStyle = t.dim;
  ctx.textAlign = 'right';
  ctx.fillText('MY YEAR IN TV', W - M, 150);
  ctx.textAlign = 'left';
  spacing(0);

  // Year
  ctx.font = `${t.weight} 300px ${t.display}`;
  const yearSize = Math.min(300, Math.floor((300 * (W - 2 * M)) / ctx.measureText(String(w.year)).width));
  ctx.font = `${t.weight} ${yearSize}px ${t.display}`;
  ctx.fillStyle = t.text;
  ctx.shadowColor = t.accent;
  ctx.shadowBlur = 50;
  ctx.globalAlpha = 0.5;
  ctx.fillText(String(w.year), M - 6, 440);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillText(String(w.year), M - 6, 440);
  const yg = ctx.createLinearGradient(M, 0, W - M, 0);
  yg.addColorStop(0, t.accent);
  yg.addColorStop(1, t.accent2);
  ctx.fillStyle = yg;
  ctx.fillRect(M, 488, W - 2 * M, 8);

  // Persona panel
  let y = 530;
  const panelH = 280;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = t.panel;
  rr(M, y, W - 2 * M, panelH, 28);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = t.dim;
  ctx.font = `600 30px ${t.mono}`;
  spacing(4);
  ctx.fillText('VIEWER PERSONA', M + 48, y + 66);
  spacing(0);
  ctx.fillStyle = t.accent;
  ctx.font = `${t.weight} 76px ${t.display}`;
  ctx.fillText(fit(up(w.persona.name), W - 2 * M - 96), M + 48, y + 150);
  ctx.fillStyle = t.text;
  ctx.font = `500 36px ${t.body}`;
  wrap(w.persona.line, W - 2 * M - 96, 2).forEach((ln, i) => ctx.fillText(ln, M + 48, y + 206 + i * 46));

  // KPIs
  y += panelH + 50;
  const kpis: [string, string][] = [
    ['HOURS', `${w.source === 'completed' ? '≈' : ''}${w.hours.toLocaleString('en')}`],
    ['EPISODES', w.episodes.toLocaleString('en')],
    ['FINISHED', String(w.finished.length)],
  ];
  const colW = (W - 2 * M) / 3;
  kpis.forEach(([label, value], i) => {
    const x = M + i * colW;
    ctx.fillStyle = t.text;
    ctx.font = `${t.weight} 96px ${t.display}`;
    ctx.fillText(fit(value, colW - 24), x, y + 96);
    ctx.fillStyle = t.dim;
    ctx.font = `600 28px ${t.mono}`;
    spacing(4);
    ctx.fillText(label, x, y + 142);
    spacing(0);
  });

  // Top 3 shows (coloured blocks stand in for posters, which may be CORS-blocked)
  y += 210;
  ctx.fillStyle = t.dim;
  ctx.font = `600 30px ${t.mono}`;
  spacing(4);
  ctx.fillText('TOP SHOWS', M, y);
  spacing(0);
  y += 30;
  const rowH = 150;
  const shows = w.topShows.slice(0, 3);
  if (!shows.length) {
    ctx.fillStyle = t.dim;
    ctx.font = `500 38px ${t.body}`;
    ctx.fillText('Your top shows will appear here.', M, y + 80);
  }
  shows.forEach((s, i) => {
    const ry = y + i * (rowH + 18);
    const h = hashStr(s.entry.show.id + s.entry.show.title);
    const h1 = h % 360;
    const h2 = (h1 + 30 + ((h >> 8) % 90)) % 360;
    const bw = 100;
    const g = ctx.createLinearGradient(M, ry, M + bw, ry + rowH);
    g.addColorStop(0, `hsl(${h1} 65% 34%)`);
    g.addColorStop(1, `hsl(${h2} 75% 14%)`);
    ctx.fillStyle = g;
    rr(M, ry, bw, rowH, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${t.weight} 64px ${t.display}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), M + bw / 2, ry + rowH / 2 + 22);
    ctx.textAlign = 'left';
    const tx = M + bw + 36;
    const tw = W - M - tx;
    ctx.fillStyle = t.text;
    ctx.font = `700 48px ${t.display}`;
    const lines = wrap(up(s.entry.show.title), tw, 2);
    const baseY = lines.length > 1 ? ry + 50 : ry + 72;
    lines.forEach((ln, j) => ctx.fillText(ln, tx, baseY + j * 52));
    ctx.fillStyle = t.dim;
    ctx.font = `500 32px ${t.body}`;
    ctx.fillText(`${s.episodes} episodes${s.entry.rating != null ? ` · rated ${s.entry.rating}/10` : ''}`, tx, baseY + (lines.length - 1) * 52 + 46);
  });

  // Genre + footer
  const fy = H - 196;
  const g0 = w.topGenres[0];
  if (g0) {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = t.panel;
    rr(M, fy - 110, W - 2 * M, 104, 52);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = t.dim;
    ctx.font = `600 28px ${t.mono}`;
    spacing(4);
    ctx.fillText('TOP GENRE', M + 44, fy - 47);
    spacing(0);
    const lw = ctx.measureText('TOP GENRE').width + 4 * 9;
    ctx.fillStyle = t.text;
    ctx.font = `700 46px ${t.display}`;
    ctx.fillText(fit(up(genreLabel(g0.genre)), W - 2 * M - lw - 260), M + 64 + lw, fy - 44);
    ctx.fillStyle = t.accent;
    ctx.font = `700 40px ${t.body}`;
    ctx.textAlign = 'right';
    ctx.fillText(pct(g0.share), W - M - 44, fy - 46);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = t.faint;
  ctx.font = `600 28px ${t.mono}`;
  spacing(5);
  ctx.fillText('DEALO TV', M, H - 96);
  ctx.textAlign = 'right';
  ctx.fillText(`#DEALOWRAPPED${w.year}`, W - M, H - 96);
  ctx.textAlign = 'left';
  spacing(0);

  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

/* ───────────── page ───────────── */

export default function Wrapped() {
  const entries = useLibrary((s) => s.entries);
  const activity = useLibrary((s) => s.activity);
  const hydrated = useLibrary((s) => s.hydrated);
  const reduceFx = useSettings((s) => s.reduceFx);
  const { year: yearParam } = useParams();
  const navigate = useNavigate();

  const years = useMemo(() => wrappedYears({ entries, activity }), [entries, activity]);
  const year = useMemo(() => (yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : defaultWrappedYear({ entries, activity })), [yearParam, entries, activity]);
  const w = useMemo(() => computeWrapped({ entries, activity }, year), [entries, activity, year]);
  const pickerYears = useMemo(() => [...new Set([...years, year])].sort((a, b) => b - a), [years, year]);

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [run, setRun] = useState(0); // bump to replay
  const exit = useCallback(() => navigate('/stats'), [navigate]);
  const replay = useCallback(() => {
    setIdx(0);
    setPaused(false);
    setRun((r) => r + 1);
  }, []);
  const goYear = useCallback((y: number) => navigate(`/wrapped/${y}`), [navigate]);

  const slides = useMemo(() => buildSlides(w, replay, pickerYears, goYear), [w, replay, pickerYears, goYear]);
  const last = slides.length - 1;
  const cur = Math.min(idx, last);

  useEffect(() => {
    setIdx(0);
    setPaused(false);
  }, [year]);

  const go = useCallback((d: number) => setIdx((i) => Math.max(0, Math.min(last, Math.min(i, last) + d))), [last]);

  // Lock page scroll under the story.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Auto-advance + progress fill (rAF so it keeps working with reduced motion and pauses cleanly).
  const fillRef = useRef<HTMLSpanElement>(null);
  const stopRef = useRef(false);
  stopRef.current = paused || holding;
  const ms = slides[cur]?.ms ?? SLIDE_MS;
  useEffect(() => {
    let raf = 0;
    let elapsed = 0;
    let prev = performance.now();
    const final = cur >= last;
    const tick = (t: number) => {
      const dt = Math.min(100, t - prev);
      prev = t;
      if (!stopRef.current && !document.hidden && !final) elapsed += dt;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${final ? 1 : Math.min(1, elapsed / ms)})`;
      if (!final && elapsed >= ms) {
        go(1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cur, last, ms, go, run]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (document.querySelector('.overlay')) return; // command palette / modal open
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exit();
      } else if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [go, exit]);

  // Tap left/right or swipe; press-and-hold pauses. Buttons/links never navigate.
  const press = useRef<{ x: number; y: number; timer: number; held: boolean; moved: boolean; noTap: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (e.button !== 0 || el.closest('a,button,select,input,label,textarea')) return;
    const p = { x: e.clientX, y: e.clientY, timer: 0, held: false, moved: false, noTap: !!el.closest('[data-no-tap]') };
    p.timer = window.setTimeout(() => {
      p.held = true;
      setHolding(true);
    }, 240);
    press.current = p;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.moved) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
      p.moved = true;
      if (!p.held) clearTimeout(p.timer);
    }
  };
  const release = (nav: boolean, e?: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    clearTimeout(p.timer);
    if (p.held) {
      setHolding(false);
      return;
    }
    if (!nav || !e) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (p.moved) {
      // Horizontal swipe: left → next, right → previous. Vertical drags are scrolls.
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
      return;
    }
    if (p.noTap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const left = e.clientX - rect.left < rect.width * 0.33;
    if (left) go(-1);
    else if (cur < last) go(1);
  };

  if (!hydrated) {
    return (
      <div className="wr wr--plain">
        <div className="spinner" />
      </div>
    );
  }

  if (!years.length) {
    return (
      <div className="page">
        <h1 className="page-title">Wrapped</h1>
        <Empty
          icon={<Sparkles size={36} />}
          title="Nothing to wrap yet"
          actions={
            <>
              <Link className="btn btn--primary" to="/settings/import">
                Import your history
              </Link>
              <Link className="btn btn--ghost" to="/stats">
                Back to Stats
              </Link>
            </>
          }
        >
          Tick off episodes or import a sheet with start/finish dates — your year in TV appears here.
        </Empty>
      </div>
    );
  }

  const slide = slides[cur];
  return (
    <div className={`wr${holding ? ' is-holding' : ''}${paused ? ' is-paused' : ''}${reduceFx ? ' is-calm' : ''}`} data-tone={slide.tone} role="region" aria-roledescription="story" aria-label={`Dealo Wrapped ${w.year}`}>
      <div className="wr__bg" aria-hidden>
        <span className="wr__glow wr__glow--a" />
        <span className="wr__glow wr__glow--b" />
        <span className="wr__glow wr__glow--c" />
        <span className="wr__grid" />
      </div>

      <header className="wr__top">
        <div className="wr__progress" aria-hidden>
          {slides.map((sl, i) => (
            <span key={sl.id} className="wr__seg">
              <span ref={i === cur ? fillRef : undefined} className="wr__fill" style={{ transform: `scaleX(${i < cur ? 1 : 0})` }} />
            </span>
          ))}
        </div>
        <div className="wr__bar">
          <span className="wr__brand">
            <Sparkles size={16} aria-hidden /> <span className="wr__brand-text">Wrapped</span>
          </span>
          <label className="wr__year-pick">
            <span className="sr-only">Year</span>
            <select value={year} onChange={(e) => goYear(Number(e.target.value))}>
              {pickerYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <span className="wr__count" aria-live="polite">
            {cur + 1}/{slides.length}
            <span className="sr-only">: {slide.label}</span>
          </span>
          <span className="wr__spacer" />
          <Link className="btn btn--ghost btn--sm wr__stats" to="/stats">
            <BarChart3 size={15} /> <span>Stats</span>
          </Link>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'} title={paused ? 'Play (Space)' : 'Pause (Space)'}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={exit} aria-label="Close Wrapped" title="Close (Esc)">
            <X size={17} />
          </button>
        </div>
      </header>

      <div
        className="wr__stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => release(true, e)}
        onPointerCancel={() => release(false)}
        onPointerLeave={() => release(false)}
        onContextMenu={(e) => press.current && e.preventDefault()}
      >
        <section key={`${slide.id}-${w.year}-${run}`} className={`wr-slide wr-slide--${slide.id}`} aria-label={slide.label}>
          {slide.render()}
        </section>
      </div>

      <button className="wr__nav wr__nav--prev btn btn--icon" onClick={() => go(-1)} disabled={cur === 0} aria-label="Previous slide">
        <ChevronLeft size={22} />
      </button>
      <button className="wr__nav wr__nav--next btn btn--icon" onClick={() => go(1)} disabled={cur === last} aria-label="Next slide">
        <ChevronRight size={22} />
      </button>

      {(paused || holding) && cur < last && (
        <div className="wr__paused" aria-hidden>
          <Pause size={14} /> Paused
        </div>
      )}
    </div>
  );
}

