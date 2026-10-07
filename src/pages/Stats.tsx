import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Award, BarChart3, Flame, Gift, Trophy } from 'lucide-react';
import { useLibrary } from '../store/library';
import { computeStats } from '../stats/compute';
import { computeBadges, streakStatus } from '../stats/badges';
import { Badges } from '../components/Badges';
import { GENRE_LABELS } from '../lib/genres';
import { STATUS_LABEL, fmtDate } from '../lib/labels';
import { STATUS_ORDER } from '../types';
import { remember, showPath } from '../lib/showCache';
import { BarList, Columns, Heatmap, Ring } from '../components/charts';
import { Poster } from '../components/Poster';
import { Empty } from '../components/Empty';

const compact = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString());

export default function Stats() {
  const entries = useLibrary((s) => s.entries);
  const activity = useLibrary((s) => s.activity);
  const blocked = useLibrary((s) => s.blocked);
  const s = useMemo(() => computeStats({ entries, activity }), [entries, activity]);
  const badges = useMemo(() => computeBadges({ entries, activity, blocked }, s), [entries, activity, blocked, s]);

  if (!s.total)
    return (
      <div className="page">
        <h1 className="page-title">Stats</h1>
        <Empty icon={<BarChart3 size={36} />} title="No data yet" actions={<Link className="btn btn--primary" to="/settings/import">Import your history</Link>}>
          Add shows, rate them and tick off episodes — your viewing telemetry shows up here.
        </Empty>
      </div>
    );

  const days = Math.floor(s.lifetimeHours / 24);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Stats</h1>
          <p className="page-sub">Your viewing telemetry — computed live from your library and episode log.</p>
        </div>
        <div className="spacer" />
        <Link className="btn btn--primary" to="/wrapped">
          <Gift size={16} /> Your Wrapped
        </Link>
      </div>

      <div className="kpis">
        <div className="panel kpi">
          <span className="kpi__label">Time watched</span>
          <span className="kpi__value">
            {compact(s.lifetimeHours)}
            <small>hrs</small>
          </span>
          <span className="kpi__sub">≈ {days} days of your life · {compact(s.lifetimeEpisodes)} episodes</span>
        </div>
        <div className="panel kpi">
          <span className="kpi__label">Shows finished</span>
          <span className="kpi__value">{s.byStatus.completed}</span>
          <span className="kpi__sub">
            {s.byStatus.watching} in progress · {s.byStatus.plan} queued
          </span>
        </div>
        <div className="panel kpi">
          <span className="kpi__label">Average rating</span>
          <span className="kpi__value">
            {s.avgRating ?? '—'}
            {s.avgRating && <small>/10</small>}
          </span>
          <span className="kpi__sub">{s.ratedCount} shows rated</span>
        </div>
        <div className="panel kpi">
          <span className="kpi__label">Watch streak</span>
          <span className="kpi__value">
            {s.streak.current}
            <small>day{s.streak.current === 1 ? '' : 's'}</small>
          </span>
          <span className="kpi__sub">
            {streakStatus(s) === 'at-risk' ? (
              <span className="streak-risk">
                <Flame size={12} /> Watch an episode today to keep it alive
              </span>
            ) : (
              <>
                Longest {s.streak.longest} · {s.activeDays} active days
              </>
            )}
          </span>
        </div>
      </div>

      <div className="dash" style={{ marginTop: 14 }}>
        <section className="panel panel--pad span-12">
          <h2 className="chart-title">
            Episode activity <span>last 12 months · {s.trackedEpisodes} tracked episodes</span>
          </h2>
          {s.trackedEpisodes ? (
            <Heatmap days={s.heatmap} caption="Episodes watched per day over the last year" />
          ) : (
            <p className="dim" style={{ margin: 0 }}>
              Tick episodes on a show's page (or hit “Watched S1·E2” on Home) and every day you watch lights up here.
            </p>
          )}
        </section>

        <section className="panel panel--pad span-8">
          <h2 className="chart-title">
            Taste by genre <span>weighted by status, rating & favourites</span>
          </h2>
          <BarList
            caption="Genre engagement"
            items={s.genres.slice(0, 10).map((g) => ({ label: GENRE_LABELS[g.genre], value: g.value, key: g.genre }))}
            format={(v) => v.toFixed(1)}
            tip={(i) => `${i.label}: ${s.genres.find((g) => GENRE_LABELS[g.genre] === i.label)?.count ?? 0} shows`}
          />
        </section>

        <section className="panel panel--pad span-4 completion-panel">
          <h2 className="chart-title">Completion rate</h2>
          {s.completionRate != null ? (
            <>
              <Ring value={s.completionRate} label="Shows you start that you finish" size={150} />
              <p className="dim" style={{ margin: 0, textAlign: 'center' }}>
                of the shows you start, you finish
              </p>
            </>
          ) : (
            <p className="dim">Not enough data yet.</p>
          )}
        </section>

        <section className="panel panel--pad">
          <h2 className="chart-title">
            Episodes per month <span>tracked</span>
          </h2>
          <Columns caption="Episodes watched per month" items={s.months.map((m) => ({ label: m.label, value: m.episodes }))} tip={(i) => `${i.label}: ${i.value} episodes`} />
        </section>

        <section className="panel panel--pad">
          <h2 className="chart-title">
            Your ratings <span>{s.ratedCount} rated</span>
          </h2>
          <Columns caption="Distribution of your ratings" items={s.ratingHist.map((v, i) => ({ label: String(i + 1), value: v }))} tip={(i) => `Rated ${i.label}/10: ${i.value} shows`} />
        </section>

        <section className="panel panel--pad span-4">
          <h2 className="chart-title">Library</h2>
          <BarList caption="Shows by list" items={STATUS_ORDER.map((st) => ({ label: STATUS_LABEL[st], value: s.byStatus[st] }))} />
        </section>

        <section className="panel panel--pad span-4">
          <h2 className="chart-title">Eras</h2>
          <BarList caption="Shows by decade" items={s.decades} />
        </section>

        <section className="panel panel--pad span-4">
          <h2 className="chart-title">Networks</h2>
          {s.networks.length ? <BarList caption="Top networks" items={s.networks} /> : <p className="dim">—</p>}
        </section>

        {s.trackedEpisodes > 0 && (
          <section className="panel panel--pad span-4">
            <h2 className="chart-title">Watch days</h2>
            <Columns caption="Episodes by weekday" height={150} items={s.weekdays.map((v, i) => ({ label: dow[i], value: v }))} tip={(i) => `${i.label}: ${i.value} episodes`} />
          </section>
        )}

        {s.languages.length > 1 && (
          <section className="panel panel--pad span-4">
            <h2 className="chart-title">Languages</h2>
            <BarList caption="Shows by original language" items={s.languages} />
          </section>
        )}

        {s.bingeKing && (
          <section className="panel panel--pad span-4 binge">
            <h2 className="chart-title">
              <Flame size={15} /> Biggest binge
            </h2>
            <div className="binge__body">
              <div className="binge__poster">
                <Poster show={s.bingeKing.entry.show} />
              </div>
              <div>
                <div className="kpi__value">{s.bingeKing.episodes}</div>
                <div className="dim">
                  episodes of <b>{s.bingeKing.entry.show.title}</b> on {fmtDate(s.bingeKing.day)}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="panel panel--pad span-12">
          <h2 className="chart-title">
            <Award size={15} /> Badges <span>{badges.filter((b) => b.tier > 0).length} of {badges.length} earned · {badges.filter((b) => b.tier === 3).length} gold</span>
          </h2>
          <Badges badges={badges} />
        </section>

        {s.topRated.length > 0 && (
          <section className="panel panel--pad span-12">
            <h2 className="chart-title">
              <Trophy size={15} /> Your hall of fame
            </h2>
            <div className="fame">
              {s.topRated.map((e, i) => (
                <Link key={e.id} to={showPath(e.id)} onClick={() => remember(e.show)} className="fame__item">
                  <span className="fame__rank">{String(i + 1).padStart(2, '0')}</span>
                  <span className="fame__poster">
                    <Poster show={e.show} />
                  </span>
                  <span className="fame__title">{e.show.title}</span>
                  <span className="fame__score">{e.rating}/10</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
