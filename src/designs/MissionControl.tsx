import { useMemo, useState } from 'react';
import { useCollections } from './useCollections';
import { useLibrary } from '../store/library';
import { useUpcoming } from '../hooks/useUpcoming';
import { computeStats } from '../stats/compute';
import { useNow, useReducedMotion } from './mission/parts';
import { Airing, NowWatching, Radar, SystemLog, TasteDna, Telemetry, Watched, Watchlist, Wildcard } from './mission/panels';

/**
 * Mission Control — a live operations console: everything at once, in a
 * strong 12-column grid (2 columns on tablets, 1 on phones). Library panels
 * lead; recommendations come last as the extra.
 */
export default function MissionControl() {
  const { collections, recs } = useCollections();
  const entries = useLibrary((s) => s.entries);
  const activity = useLibrary((s) => s.activity);
  const stats = useMemo(() => computeStats({ entries, activity }), [entries, activity]);
  const air = useUpcoming();
  const [mountedAt] = useState(() => new Date().toISOString());
  const still = useReducedMotion();

  const get = (id: string) => collections.find((c) => c.id === id)?.items ?? [];
  const watching = get('continue');
  const watchlist = get('watchlist');
  const out = recs.output;
  const airingWeek = air.upcoming.filter((u) => u.days >= 0 && u.days <= 7).length;
  const newEps = air.recent.filter((r) => r.isNew).length;

  const status = [
    `${get('watched').length} watched`,
    `${watching.length} in progress`,
    `${watchlist.length} on watchlist`,
    air.status === 'ready' ? `${airingWeek} airing this week` : undefined,
    newEps ? `${newEps} new episode${newEps > 1 ? 's' : ''}` : undefined,
  ].filter(Boolean) as string[];

  return (
    <div className={`page mc${still ? ' mc--still' : ''}`}>
      <header className="panel mc-bar">
        <div className="mc-bar__id">
          <h1 className="mc-bar__title">Mission Control</h1>
          <p className="mc-bar__status">
            <span className="mc-bar__nominal">
              <span className="mc-dot mc-dot--ok" aria-hidden />
              All systems nominal
            </span>
            {status.map((s) => (
              <span key={s} className="mc-bar__stat">
                {s}
              </span>
            ))}
          </p>
        </div>
        <Clock />
      </header>

      <div className="mc-grid">
        {/* Library first (watched → watching → watchlist), then the schedule and numbers; recommendations are the extra. */}
        <Watched items={get('watched')} />
        <NowWatching items={watching} />
        <Watchlist items={watchlist} />
        <Airing status={air.status} upcoming={air.upcoming} recent={air.recent} progress={air.progress} />
        <Telemetry stats={stats} />
        <Radar picks={out?.picks} stage={recs.stage} />
        <Wildcard ranked={out?.ranked} picks={out?.picks} />
        <TasteDna traits={out?.traits} />
        <SystemLog mountedAt={mountedAt} />
      </div>
    </div>
  );
}

function Clock() {
  const now = useNow(1000);
  return (
    <div className="mc-clock">
      <time className="mc-clock__time" dateTime={now.toISOString()}>
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </time>
      <span className="mc-clock__date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
    </div>
  );
}
