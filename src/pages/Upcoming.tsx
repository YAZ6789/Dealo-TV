import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, BellOff, CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, EyeOff, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import type { LibraryEntry } from '../types';
import { refreshUpcoming, useUpcoming, type AiringItem } from '../hooks/useUpcoming';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { remember, showPath } from '../lib/showCache';
import { plural, relTime } from '../lib/labels';
import {
  buildIcs,
  diffDays,
  epCode,
  episodeOverview,
  episodeTitle,
  episodeUid,
  groupByWeek,
  hasRealName,
  localIso,
  relDays,
  weekDates,
} from '../lib/airing';
import { Poster } from '../components/Poster';
import { Empty } from '../components/Empty';
import { toast } from '../components/toast';
import {
  itemKey,
  markNotified,
  notifyPermission,
  notifyPref,
  notifySupported,
  setNotifyPref,
  showSystemNotification,
  useAiringNotifications,
  useIsWatched,
  useNewEpisodes,
  type NotifyState,
} from '../components/NewEpisodesBanner';

/** Same rule as the upcoming hook: what counts as a show you "follow". */
function follows(e: LibraryEntry): boolean {
  if (e.status === 'dropped') return false;
  if (e.status === 'completed') return e.show.airStatus === 'ongoing' || e.show.airStatus === 'upcoming';
  return true;
}

const at = (iso: string) => new Date(`${iso}T12:00:00`);
const fmtDay = (iso: string) => at(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = (iso: string) => at(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtLong = (iso: string) => at(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** Today's local date, rolling over at midnight while the page stays open. */
function useToday() {
  const [today, setToday] = useState(localIso);
  useEffect(() => {
    const t = setInterval(() => setToday(localIso()), 60_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

export default function Upcoming() {
  const { status, upcoming, recent, lastVisit, progress, loadedAt } = useUpcoming();
  const hydrated = useLibrary((s) => s.hydrated);
  const entries = useLibrary((s) => s.entries);
  const spoilerFree = useSettings((s) => s.spoilerFree);
  const online = useOnline();
  const today = useToday();
  const isWatched = useIsWatched();
  const { all: newItems, unwatched: newUnwatched } = useNewEpisodes(recent);
  useAiringNotifications();
  const [weekOffset, setWeekOffset] = useState(0);

  const followed = useMemo(() => Object.values(entries).filter(follows).length, [entries]);
  const loading = status === 'loading';

  const daysOf = (i: AiringItem) => diffDays(today, i.airDate);
  const next30 = upcoming.filter((i) => daysOf(i) >= 0 && daysOf(i) <= 30).length;

  // Recently aired items that aren't "new" (first visit, or seen before) — still useful to catch up on.
  const recentOther = recent.filter((i) => !newItems.includes(i) && !isWatched(i));

  const week = weekDates(today, weekOffset);
  const thisWeekEnd = weekDates(today, 0)[6];
  const calendarItems = useMemo(() => {
    const seen = new Set<string>();
    const out: AiringItem[] = [];
    for (const i of [...recent, ...upcoming]) {
      const k = itemKey(i);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(i);
    }
    return out;
  }, [recent, upcoming]);
  const maxOffset = useMemo(() => {
    const last = upcoming.reduce((m, i) => (i.airDate > m ? i.airDate : m), today);
    return Math.max(0, Math.min(8, Math.floor(diffDays(weekDates(today, 0)[0], last) / 7)));
  }, [upcoming, today]);

  const later = upcoming.filter((i) => i.airDate > thisWeekEnd && daysOf(i) <= 60);
  const further = upcoming.filter((i) => daysOf(i) > 60);

  const ctx: ItemCtx = { spoilerFree, isWatched, today };

  const downloadIcs = () => {
    const base = `${location.origin}${location.pathname}`;
    const events = upcoming.map((i) => {
      const name = !spoilerFree && hasRealName(i.episode.name) ? i.episode.name : undefined;
      const overview = episodeOverview(i.episode, { spoilerFree, watched: false });
      return {
        uid: episodeUid(i.entry.id, i.episode.season, i.episode.number),
        date: i.airDate,
        summary: `${i.show.title} ${epCode(i.episode.season, i.episode.number)}${name ? ` – ${name}` : ''}`,
        description: [i.show.networks?.[0] ? `On ${i.show.networks[0]}` : '', overview ?? '', 'Added from Dealo TV'].filter(Boolean).join('\n\n'),
        url: `${base}#${showPath(i.entry.id)}`,
      };
    });
    const blob = new Blob([buildIcs(events, { name: 'Dealo TV — Airing' })], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dealo-airing-${today}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Saved ${plural(events.length, 'episode')} — open the .ics file to add them to your calendar`);
  };

  const countsLine = (
    <>
      <b className={newUnwatched.length ? 'air-hl' : undefined}>{newUnwatched.length ? `${plural(newUnwatched.length, 'new episode')} since your last visit` : 'No new episodes since your last visit'}</b>
      <span aria-hidden> · </span>
      <span>{next30 ? `${next30} airing in the next 30 days` : 'nothing airing in the next 30 days'}</span>
    </>
  );

  const hasData = upcoming.length > 0 || recent.length > 0;

  if (!hydrated) {
    return (
      <div className="page air">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page air">
      <div className="page-head air-head">
        <div className="air-head__text">
          <h1 className="page-title">Airing</h1>
          <p className="page-sub">{!followed ? 'New-episode alerts and a weekly calendar' : status !== 'ready' && !hasData ? 'Checking your shows for new episodes…' : countsLine}</p>
          {followed > 0 && (
            <p className="air-head__meta">
              Tracking {plural(followed, 'show')}
              {lastVisit && <> · last visit {relTime(lastVisit)}</>}
              {loadedAt && !loading && <> · checked {relTime(new Date(loadedAt).toISOString())}</>}
              {spoilerFree && (
                <span className="tag air-tag">
                  <EyeOff size={12} /> Spoiler-free
                </span>
              )}
            </p>
          )}
        </div>
        <div className="spacer" />
        {followed > 0 && (
          <div className="cluster air-head__actions">
            <button className="btn btn--sm" onClick={downloadIcs} disabled={!upcoming.length} title={upcoming.length ? 'Download an .ics file of upcoming episodes' : 'No upcoming episodes to export yet'}>
              <CalendarPlus size={15} /> Add to calendar
            </button>
            <button className="btn btn--sm btn--primary" onClick={() => void refreshUpcoming(true)} disabled={loading} aria-busy={loading}>
              <RefreshCw size={15} className={loading ? 'air-spin' : undefined} />
              {loading ? `Checking ${progress.done}/${progress.total}` : 'Refresh'}
            </button>
          </div>
        )}
      </div>

      {loading && progress.total > 0 && (
        <div className="air-progress" role="progressbar" aria-label="Checking your shows for new episodes" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="bar">
            <div className="bar__fill" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        </div>
      )}

      {followed === 0 ? (
        <NothingFollowed />
      ) : (
        <>
          <NotifyBar newKeys={newUnwatched.map(itemKey)} />

          {!online && (
            <div className="note note--warn air-note" role="status">
              <WifiOff size={18} />
              <span>
                You're offline. {hasData ? 'Showing what Dealo found last time — refresh when you’re back online.' : 'Air dates need a connection to the show database; they’ll appear here once you’re back online.'}
              </span>
            </div>
          )}

          {status === 'ready' && !hasData && online && (
            <div className="panel panel--pad air-unknown">
              <CalendarClock size={28} className="air-unknown__icon" />
              <div>
                <h3>No air dates yet</h3>
                <p>
                  None of your {plural(followed, 'followed show')} has an episode announced right now — or the show database couldn’t be reached. New dates usually appear a few weeks before a
                  season starts; try refreshing later.
                </p>
              </div>
            </div>
          )}

          {(status !== 'ready' && !hasData) ? (
            <div className="air-loading">
              <div className="spinner" />
              <span>Checking {plural(progress.total || followed, 'show')} for new episodes…</span>
            </div>
          ) : null}

          {(newItems.length > 0 || recentOther.length > 0) && (
            <section className="section air-section" aria-labelledby="air-new-h">
              <h2 className="section-title" id="air-new-h">
                {newItems.length ? 'New since your last visit' : 'Recently aired'}
                <span className="count">{newItems.length ? `${newUnwatched.length} unwatched` : recentOther.length}</span>
              </h2>
              {newItems.length > 0 && lastVisit && <p className="section-sub">Episodes that aired after {fmtLong(localIso(new Date(lastVisit)))}.</p>}
              <div className="air-new">
                {(newItems.length ? newItems : recentOther).map((i) => (
                  <NewCard key={itemKey(i)} item={i} ctx={ctx} isNew={newItems.includes(i)} />
                ))}
              </div>
              {newItems.length > 0 && recentOther.length > 0 && (
                <p className="hint air-also">
                  Also aired recently: {recentOther.slice(0, 4).map((i, n) => (
                    <span key={itemKey(i)}>
                      {n > 0 && ', '}
                      <Link to={showPath(i.entry.id)} onClick={() => remember(i.show)}>
                        {i.show.title} {epCode(i.episode.season, i.episode.number)}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </section>
          )}

          {hasData && (
            <section className="section air-section" aria-labelledby="air-week-h">
              <div className="air-weekhead">
                <h2 className="section-title" id="air-week-h">
                  {weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : `Week of ${fmtShort(week[0])}`}
                  <span className="count">
                    {fmtShort(week[0])} – {fmtShort(week[6])}
                  </span>
                </h2>
                <div className="air-weeknav">
                  <button className="btn btn--sm btn--icon" onClick={() => setWeekOffset((w) => w - 1)} disabled={weekOffset <= -1} aria-label="Previous week">
                    <ChevronLeft size={16} />
                  </button>
                  {weekOffset !== 0 && (
                    <button className="btn btn--sm btn--ghost" onClick={() => setWeekOffset(0)}>
                      Today
                    </button>
                  )}
                  <button className="btn btn--sm btn--icon" onClick={() => setWeekOffset((w) => w + 1)} disabled={weekOffset >= maxOffset} aria-label="Next week">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <WeekCalendar days={week} items={calendarItems} ctx={ctx} />
            </section>
          )}

          {hasData && (
            <section className="section air-section" aria-labelledby="air-later-h">
              <h2 className="section-title" id="air-later-h">
                Later
                <span className="count">next 60 days</span>
              </h2>
              {later.length ? (
                <div className="air-later">
                  {groupByWeek(later).map((g) => (
                    <div key={g.start} className="air-later__week">
                      <div className="air-later__label">
                        <span>Week of {fmtShort(g.start)}</span>
                        <span className="air-later__rel">{relDays(Math.max(diffDays(today, g.start), diffDays(today, g.items[0].airDate)))}</span>
                      </div>
                      <div className="list">
                        {g.items.map((i) => (
                          <LaterRow key={itemKey(i)} item={i} ctx={ctx} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">Nothing else announced for the next two months{upcoming.length ? '' : ' yet'}.</p>
              )}
              {further.length > 0 && (
                <div className="air-later__week air-further">
                  <div className="air-later__label">
                    <span>Further out</span>
                  </div>
                  <div className="list">
                    {further.map((i) => (
                      <LaterRow key={itemKey(i)} item={i} ctx={ctx} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

interface ItemCtx {
  spoilerFree: boolean;
  isWatched: (i: AiringItem) => boolean;
  today: string;
}

function Thumb({ item, size = 'sm' }: { item: AiringItem; size?: 'sm' | 'md' }) {
  return (
    <span className={`air-thumb air-thumb--${size}`} aria-hidden>
      <Poster show={item.show} />
    </span>
  );
}

function useOpen() {
  const nav = useNavigate();
  return (i: AiringItem) => {
    remember(i.show);
    nav(showPath(i.entry.id));
  };
}

/* ───────────── New since your last visit ───────────── */

function NewCard({ item, ctx, isNew }: { item: AiringItem; ctx: ItemCtx; isNew: boolean }) {
  const open = useOpen();
  const toggleEpisode = useLibrary((s) => s.toggleEpisode);
  const inLibrary = useLibrary((s) => !!s.entries[item.entry.id]);
  const watched = ctx.isWatched(item);
  const { season, number } = item.episode;
  const code = epCode(season, number);
  const title = episodeTitle(item.episode, { spoilerFree: ctx.spoilerFree, watched });
  const days = diffDays(ctx.today, item.airDate);
  const toggle = () => {
    toggleEpisode(item.entry.id, season, number, item.episode.runtime);
    if (!watched) toast(`✓ ${item.show.title} ${code}`, { label: 'Undo', run: () => toggleEpisode(item.entry.id, season, number) });
  };
  return (
    <article className={`air-card${watched ? ' is-watched' : ''}`}>
      <button className="air-card__poster" onClick={() => open(item)} aria-label={`Open ${item.show.title}`} tabIndex={-1}>
        <Poster show={item.show} />
      </button>
      <div className="air-card__body">
        <div className="air-card__kicker">
          {watched ? (
            <span className="air-badge air-badge--ok">
              <Check size={12} /> Watched
            </span>
          ) : isNew ? (
            <span className="air-badge">
              <Sparkles size={12} /> New
            </span>
          ) : (
            <span className="air-badge air-badge--muted">Aired</span>
          )}
          <span>
            {fmtDay(item.airDate)} · {relDays(days)}
          </span>
        </div>
        <h3 className="air-card__show">{item.show.title}</h3>
        <p className="air-card__ep">
          <span className="air-code">{code}</span> {title}
        </p>
        <div className="air-card__actions">
          <button className={`btn btn--sm${watched ? '' : ' btn--primary'}`} onClick={toggle} disabled={!inLibrary} aria-label={watched ? `Mark ${item.show.title} ${code} unwatched` : `Mark ${item.show.title} ${code} watched`}>
            {watched ? 'Undo' : (<><Check size={14} /> Watched</>)}
          </button>
          <button className="btn btn--sm btn--ghost" onClick={() => open(item)}>
            Open
          </button>
        </div>
      </div>
    </article>
  );
}

/* ───────────── Week calendar (columns on desktop, agenda on phone) ───────────── */

function WeekCalendar({ days, items, ctx }: { days: string[]; items: AiringItem[]; ctx: ItemCtx }) {
  const byDay = useMemo(() => {
    const m = new Map<string, AiringItem[]>();
    for (const i of items) {
      if (i.airDate < days[0] || i.airDate > days[6]) continue;
      m.set(i.airDate, [...(m.get(i.airDate) ?? []), i]);
    }
    return m;
  }, [items, days]);
  const total = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  return (
    <div className="air-week" role="list" aria-label={`${total} episodes this week`}>
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const isToday = d === ctx.today;
        const past = d < ctx.today;
        const date = at(d);
        return (
          <div key={d} role="listitem" className={`air-day${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}${list.length ? '' : ' is-empty'}`} aria-label={`${fmtDay(d)}${isToday ? ' (today)' : ''}: ${list.length ? plural(list.length, 'episode') : 'nothing'}`}>
            <div className="air-day__head">
              <span className="air-day__dow">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="air-day__num">{date.getDate()}</span>
              {isToday && <span className="air-day__today">Today</span>}
            </div>
            <div className="air-day__body">
              {list.length ? list.map((i) => <DayChip key={itemKey(i)} item={i} ctx={ctx} />) : <span className="air-day__none">No episodes</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayChip({ item, ctx }: { item: AiringItem; ctx: ItemCtx }) {
  const watched = ctx.isWatched(item);
  const aired = item.airDate <= ctx.today;
  const title = episodeTitle(item.episode, { spoilerFree: ctx.spoilerFree, watched });
  const net = item.show.networks?.[0];
  return (
    <Link to={showPath(item.entry.id)} onClick={() => remember(item.show)} className={`air-chip${watched ? ' is-watched' : ''}`} title={`${item.show.title} ${epCode(item.episode.season, item.episode.number)} — ${title}`}>
      <Thumb item={item} />
      <span className="air-chip__text">
        <span className="air-chip__show">{item.show.title}</span>
        <span className="air-chip__ep">
          <span className="air-code">{epCode(item.episode.season, item.episode.number)}</span> {title}
        </span>
        <span className="air-chip__meta">
          {watched ? (
            <>
              <Check size={12} /> Watched
            </>
          ) : item.airDate === ctx.today ? (
            'Out today'
          ) : aired ? (
            'Aired'
          ) : (
            net ?? relDays(diffDays(ctx.today, item.airDate))
          )}
        </span>
      </span>
    </Link>
  );
}

/* ───────────── Later ───────────── */

function LaterRow({ item, ctx }: { item: AiringItem; ctx: ItemCtx }) {
  const title = episodeTitle(item.episode, { spoilerFree: ctx.spoilerFree, watched: false });
  const days = diffDays(ctx.today, item.airDate);
  const premiere = item.episode.number === 1;
  return (
    <Link to={showPath(item.entry.id)} onClick={() => remember(item.show)} className="panel list-row air-row">
      <span className="list-row__poster">
        <Poster show={item.show} />
      </span>
      <span className="list-row__main">
        <span className="list-row__title">{item.show.title}</span>
        <span className="air-row__ep">
          <span className="air-code">{epCode(item.episode.season, item.episode.number)}</span> {title}
          {premiere && <span className="tag tag--accent air-tag">{item.episode.season === 1 ? 'Series premiere' : 'Season premiere'}</span>}
        </span>
      </span>
      <span className="air-row__when">
        <span className="air-row__date">{fmtDay(item.airDate)}</span>
        <span className="air-row__rel">{relDays(days)}</span>
      </span>
    </Link>
  );
}

/* ───────────── Notifications ───────────── */

function NotifyBar({ newKeys }: { newKeys: string[] }) {
  const [perm, setPerm] = useState<NotifyState>(notifyPermission);
  const [on, setOn] = useState(() => notifyPref() && notifyPermission() === 'granted');
  const supported = notifySupported();

  const toggle = async () => {
    if (on) {
      setNotifyPref(false);
      setOn(false);
      toast('New-episode notifications off');
      return;
    }
    if (!supported) return;
    let p = Notification.permission as NotifyState;
    if (p === 'default') {
      try {
        p = (await Notification.requestPermission()) as NotifyState;
      } catch {
        p = Notification.permission as NotifyState;
      }
    }
    setPerm(p);
    if (p !== 'granted') {
      toast(p === 'denied' ? 'Notifications are blocked for this site — allow them in your browser’s site settings' : 'Notifications weren’t enabled');
      return;
    }
    // What's on screen now counts as announced; you'll hear about the next ones.
    markNotified(newKeys);
    setNotifyPref(true);
    setOn(true);
    void showSystemNotification('Dealo TV notifications are on', { body: 'You’ll get an alert here when a show you follow airs a new episode.', tag: 'dealo-notify-on', onClickHash: '#/upcoming' });
    toast('Notifications on');
  };

  const hint = !supported
    ? 'This browser doesn’t support notifications. The banner on Home still shows what’s new.'
    : perm === 'denied'
      ? 'Notifications are blocked for this site. Allow them in your browser’s site settings, then switch this on.'
      : 'Alerts appear when Dealo is open in a tab or installed as an app — true push notifications would need a server.';

  return (
    <div className={`air-notify${on ? ' is-on' : ''}`}>
      <span className="air-notify__icon" aria-hidden>
        {on ? <Bell size={18} /> : <BellOff size={18} />}
      </span>
      <div className="air-notify__text">
        <strong id="air-notify-label">Notify me about new episodes</strong>
        <span>{hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="air-notify-label"
        className={`toggle${on ? ' on' : ''}`}
        onClick={() => void toggle()}
        disabled={!supported || (perm === 'denied' && !on)}
      />
    </div>
  );
}

/* ───────────── Empty ───────────── */

function NothingFollowed() {
  return (
    <div className="panel air-empty">
      <Empty
        icon={<CalendarClock size={40} />}
        title="Nothing to track yet"
        actions={
          <>
            <Link to="/library" className="btn btn--primary">
              Open Library
            </Link>
            <Link to="/discover" className="btn">
              Find shows
            </Link>
          </>
        }
      >
        Airing keeps an eye on the shows you <b>are watching</b>, have on your <b>watchlist</b> or <b>on hold</b>, and <b>finished shows that are still running</b>. Add a few to your library
        and their new episodes and air dates will show up here.
      </Empty>
      <ul className="air-empty__list" aria-label="What Airing shows">
        <li>
          <Sparkles size={16} /> New episodes since your last visit, one tap to tick them off
        </li>
        <li>
          <CalendarClock size={16} /> A weekly calendar of what airs when
        </li>
        <li>
          <Bell size={16} /> Optional alerts and a calendar (.ics) export
        </li>
      </ul>
    </div>
  );
}
