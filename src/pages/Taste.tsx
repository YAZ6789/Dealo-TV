import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import type { Affinity, GenreKey } from '../types';
import { useLibrary } from '../store/library';
import { useRecommendations } from '../hooks/useRecommendations';
import { GENRE_LABELS, PRIMARY_GENRES, THEME_TAGS } from '../lib/genres';
import { remember, showPath } from '../lib/showCache';
import { BarList } from '../components/charts';

const LANGS: [string, string][] = [
  ['en', 'English'],
  ['ko', 'Korean'],
  ['ja', 'Japanese'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['fr', 'French'],
  ['it', 'Italian'],
  ['da', 'Danish'],
  ['sv', 'Swedish'],
  ['no', 'Norwegian'],
  ['tr', 'Turkish'],
  ['hi', 'Hindi'],
  ['zh', 'Chinese'],
  ['pt', 'Portuguese'],
];

const cycle = (v: Affinity | undefined): Affinity | 0 => (v === 1 ? -1 : v === -1 ? 0 : 1);

function TriChip({ label, value, onClick }: { label: string; value?: Affinity; onClick: () => void }) {
  return (
    <button className={`chip ${value === 1 ? 'chip--on' : value === -1 ? 'chip--off' : ''}`} onClick={onClick} aria-pressed={value === 1 ? 'true' : value === -1 ? 'mixed' : 'false'}>
      {value === 1 ? '♥ ' : value === -1 ? '⊘ ' : ''}
      {label}
    </button>
  );
}

export default function Taste() {
  const taste = useLibrary((s) => s.taste);
  const feedback = useLibrary((s) => s.feedback);
  const { setGenre, setKeyword, setPreferences, giveFeedback } = useLibrary.getState();
  const recs = useRecommendations();
  const [custom, setCustom] = useState('');
  const prefs = taste.preferences;

  const themes = useMemo(() => {
    const extra = Object.keys(taste.keywords).filter((k) => !(THEME_TAGS as readonly string[]).includes(k));
    return [...THEME_TAGS, ...extra];
  }, [taste.keywords]);

  const traits = recs.output?.traits.slice(0, 12) ?? [];
  const seeds = recs.output?.seeds.slice(0, 8) ?? [];
  const fb = Object.values(feedback);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Taste profile</h1>
          <p className="page-sub">What Dealo has learned — and your direct controls. Tap once to love, twice to avoid, again to clear.</p>
        </div>
      </div>

      <div className="two-col">
        <section className="panel panel--pad">
          <h2 className="chart-title">
            Taste DNA <span>learned from your library</span>
          </h2>
          {traits.length ? (
            <BarList caption="Strongest taste traits" items={traits.map((t) => ({ label: t.label, value: Math.round(t.weight * 100) / 100, key: t.key }))} format={(v) => v.toFixed(2)} />
          ) : (
            <p className="dim">Rate or finish a few shows and your strongest traits appear here.</p>
          )}
          {recs.output && recs.output.dislikes.length > 0 && (
            <>
              <div className="label" style={{ margin: '18px 0 8px' }}>
                Steering away from
              </div>
              <div className="chips">
                {recs.output.dislikes.map((d) => (
                  <span key={d.key} className="chip chip--sm chip--off">
                    {d.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel panel--pad">
          <h2 className="chart-title">
            Biggest influences <span>shows driving your recommendations</span>
          </h2>
          {seeds.length ? (
            <BarList
              caption="Top influence shows"
              items={seeds.map((s) => ({ label: s.show.title, value: Math.round(s.weight * 100) / 100, key: s.id }))}
              format={(v) => v.toFixed(2)}
              tip={(i) => `${i.label} — influence ${i.value}`}
            />
          ) : (
            <p className="dim">Nothing yet.</p>
          )}
          {fb.length > 0 && (
            <>
              <div className="label" style={{ margin: '18px 0 8px' }}>
                Your feedback on recommendations
              </div>
              <div className="chips">
                {fb.map((f) => (
                  <span key={f.id} className={`chip chip--sm ${f.value > 0 ? 'chip--on' : 'chip--off'}`}>
                    <Link to={showPath(f.id)} onClick={() => remember(f.show)}>
                      {f.value > 0 ? '👍' : '👎'} {f.show.title}
                    </Link>
                    <button onClick={() => giveFeedback(f.show, 0)} aria-label={`Remove feedback for ${f.show.title}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="section">
        <h2 className="section-title">Genres</h2>
        <div className="chips">
          {PRIMARY_GENRES.map((g: GenreKey) => (
            <TriChip key={g} label={GENRE_LABELS[g]} value={taste.genres[g]} onClick={() => setGenre(g, cycle(taste.genres[g]))} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Themes & vibes</h2>
        <div className="chips">
          {themes.map((k) => (
            <TriChip key={k} label={k} value={taste.keywords[k]} onClick={() => setKeyword(k, cycle(taste.keywords[k]))} />
          ))}
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              const k = custom.trim().toLowerCase();
              if (k) setKeyword(k, 1);
              setCustom('');
            }}
          >
            <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add a theme…" aria-label="Add a theme" />
            <button className="btn btn--sm btn--icon" aria-label="Add theme">
              <Plus size={14} />
            </button>
          </form>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Preferences</h2>
        <div className="panel panel--pad prefs">
          <div className="field">
            <span className="label">Original languages · none selected = any</span>
            <div className="chips">
              {LANGS.map(([code, name]) => {
                const on = prefs.languages.includes(code);
                return (
                  <button
                    key={code}
                    className={`chip chip--sm ${on ? 'chip--on' : ''}`}
                    onClick={() => setPreferences({ languages: on ? prefs.languages.filter((l) => l !== code) : [...prefs.languages, code] })}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="prefs__grid">
            <div className="field">
              <span className="label">Max seasons (commitment)</span>
              <div className="seg">
                {[undefined, 1, 2, 3, 5, 8].map((n) => (
                  <button key={String(n)} className={prefs.maxSeasons === n ? 'on' : ''} onClick={() => setPreferences({ maxSeasons: n })}>
                    {n ?? 'Any'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">Era</span>
              <div className="cluster">
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  min={1950}
                  max={2030}
                  placeholder="From"
                  value={prefs.eraFrom ?? ''}
                  onChange={(e) => setPreferences({ eraFrom: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="dim">to</span>
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  min={1950}
                  max={2030}
                  placeholder="To"
                  value={prefs.eraTo ?? ''}
                  onChange={(e) => setPreferences({ eraTo: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
            </div>
            <div className="field">
              <span className="label">Minimum community rating · {prefs.minRating ? prefs.minRating.toFixed(1) : 'off'}</span>
              <input
                type="range"
                className="slider"
                min={0}
                max={9}
                step={0.5}
                value={prefs.minRating ?? 0}
                style={{ '--v': `${((prefs.minRating ?? 0) / 9) * 100}%` } as React.CSSProperties}
                onChange={(e) => setPreferences({ minRating: Number(e.target.value) || undefined })}
                aria-label="Minimum rating"
              />
            </div>
            <label className="field toggle-field">
              <span className="label">Prefer finished shows</span>
              <button className={`toggle ${prefs.preferEnded ? 'on' : ''}`} onClick={() => setPreferences({ preferEnded: !prefs.preferEnded })} aria-pressed={!!prefs.preferEnded} aria-label="Prefer finished shows" />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
