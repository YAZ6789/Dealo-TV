import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, RefreshCw, Sparkles } from 'lucide-react';
import type { GenreKey, Recommendation } from '../types';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { ensureRecommendations } from '../recommend/pipeline';
import { useRecommendations } from '../hooks/useRecommendations';
import { GENRE_LABELS } from '../lib/genres';
import { ShowCard } from '../components/ShowCard';
import { Empty } from '../components/Empty';
import { Attribution } from './Home';

interface Mood {
  id: string;
  label: string;
  genres?: GenreKey[];
  keywords?: string[];
  test?: (r: Recommendation) => boolean;
}

const MOODS: Mood[] = [
  { id: 'mind', label: '🌀 Mind-bending', keywords: ['mind-bending', 'time travel', 'cerebral', 'multiverse', 'twist ending', 'non-linear', 'psychological'], genres: ['scifi', 'mystery'] },
  { id: 'dark', label: '🖤 Dark & gritty', keywords: ['dark', 'gritty', 'anti-hero', 'gangster', 'revenge', 'serial killer'], genres: ['crime', 'thriller'] },
  { id: 'comfort', label: '☕ Comfort watch', keywords: ['feel-good', 'wholesome', 'friendship', 'workplace', 'witty dialogue'], genres: ['comedy', 'family'] },
  { id: 'edge', label: '⚡ Edge of your seat', keywords: ['conspiracy', 'espionage', 'survival', 'heist'], genres: ['thriller', 'action'] },
  { id: 'epic', label: '🗡 Epic worlds', keywords: ['mythology', 'magic', 'medieval', 'royalty', 'power struggle', 'space'], genres: ['fantasy', 'adventure'] },
  { id: 'laugh', label: '😂 Just laugh', genres: ['comedy'] },
  { id: 'true', label: '📽 True stories', keywords: ['based on true story', 'biography', 'investigative'], genres: ['documentary', 'history'] },
  { id: 'world', label: '🌍 World TV', test: (r) => !!r.show.language && r.show.language !== 'en' },
];

const moodMatch = (m: Mood, r: Recommendation) =>
  m.test ? m.test(r) : r.show.genres.some((g) => m.genres?.includes(g)) || (r.show.keywords ?? []).some((k) => m.keywords?.includes(k));

export default function Discover() {
  const recs = useRecommendations();
  const prefs = useLibrary((s) => s.taste.preferences);
  const setPreferences = useLibrary((s) => s.setPreferences);
  const hasKey = useSettings((s) => !!s.tmdbKey && s.tmdbValid !== false);
  const [mood, setMood] = useState<string>('');
  const [genre, setGenre] = useState<GenreKey | ''>('');
  const [length, setLength] = useState<'any' | 'short' | 'limited'>('any');

  const out = recs.output;
  const genres = useMemo(() => {
    const m = new Map<GenreKey, number>();
    for (const r of out?.ranked.slice(0, 200) ?? []) for (const g of r.show.genres) m.set(g, (m.get(g) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([g]) => g);
  }, [out]);

  const items = useMemo(() => {
    if (!out) return [];
    const filtering = mood || genre || length !== 'any';
    let list = filtering ? out.ranked : [...out.picks, ...out.ranked.filter((r) => !out.picks.some((p) => p.show.id === r.show.id))];
    const m = MOODS.find((x) => x.id === mood);
    if (m) list = list.filter((r) => moodMatch(m, r));
    if (genre) list = list.filter((r) => r.show.genres.includes(genre));
    if (length === 'short') list = list.filter((r) => (r.show.seasonCount ?? 99) <= 2);
    if (length === 'limited') list = list.filter((r) => (r.show.seasonCount ?? 99) <= 1 || r.show.keywords?.includes('limited series'));
    return list.slice(0, 72);
  }, [out, mood, genre, length]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="page-sub">
            {out?.coldStart
              ? 'Rate a few shows or set your taste — recommendations get sharper with every signal.'
              : `Ranked from ${out?.seeds.length ?? 0} taste signals across your library, ratings and feedback.`}
          </p>
        </div>
        <div className="spacer" />
        <span className={`tag ${hasKey ? 'tag--accent' : ''}`} title={hasKey ? 'Live TMDB data' : 'Built-in catalog + TVmaze'}>
          <Cpu size={11} /> {hasKey ? 'TMDB live engine' : 'Offline catalog engine'}
        </span>
        <button className="btn btn--sm" onClick={() => void ensureRecommendations(true)} disabled={recs.stage !== 'ready' && recs.stage !== 'error'}>
          <RefreshCw size={14} /> Re-run
        </button>
      </div>

      <div className="panel panel--pad tune">
        <div className="tune__row">
          <span className="label">Mood</span>
          <div className="chips">
            {MOODS.map((m) => (
              <button key={m.id} className={`chip ${mood === m.id ? 'chip--on' : ''}`} onClick={() => setMood(mood === m.id ? '' : m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {genres.length > 0 && (
          <div className="tune__row">
            <span className="label">Genre</span>
            <div className="chips">
              {genres.map((g) => (
                <button key={g} className={`chip chip--sm ${genre === g ? 'chip--on' : ''}`} onClick={() => setGenre(genre === g ? '' : g)}>
                  {GENRE_LABELS[g]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="tune__grid">
          <div className="field">
            <span className="label">Commitment</span>
            <div className="seg">
              {(['any', 'short', 'limited'] as const).map((l) => (
                <button key={l} className={length === l ? 'on' : ''} onClick={() => setLength(l)}>
                  {l === 'any' ? 'Any length' : l === 'short' ? '≤ 2 seasons' : 'One & done'}
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="Adventurousness"
            left="Safe bets"
            right="Surprise me"
            value={prefs.adventurousness}
            onChange={(v) => setPreferences({ adventurousness: v })}
          />
          <Slider label="Obscurity" left="Mainstream" right="Hidden gems" value={prefs.obscurity} onChange={(v) => setPreferences({ obscurity: v })} />
        </div>
      </div>

      {!out && (
        <div className="loading-line" style={{ padding: '30px 0' }}>
          <div className="spinner" /> {recs.stage === 'error' ? recs.error : `Analysing your taste · ${recs.stage}…`}
        </div>
      )}

      {out && items.length === 0 && (
        <Empty icon={<Sparkles size={34} />} title="No matches for this filter">
          Try another mood or loosen the filters.
        </Empty>
      )}

      {items.length > 0 && (
        <div className="grid" style={{ marginTop: 26 }}>
          {items.map((r) => (
            <ShowCard key={r.show.id} show={r.show} rec={r} />
          ))}
        </div>
      )}

      {out && !out.coldStart && (
        <div className="note" style={{ marginTop: 30 }}>
          <Sparkles size={16} />
          <span>
            See what Dealo has learned about you on the <Link to="/taste" className="accent">Taste profile</Link> — and correct it.
          </span>
        </div>
      )}
      <Attribution />
    </div>
  );
}

function Slider({ label, left, right, value, onChange }: { label: string; left: string; right: string; value: number; onChange: (v: number) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="field">
      <span className="label">{label}</span>
      <input
        type="range"
        className="slider"
        min={0}
        max={1}
        step={0.05}
        value={v}
        style={{ '--v': `${v * 100}%` } as React.CSSProperties}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => onChange(v)}
        onKeyUp={() => onChange(v)}
        aria-label={label}
      />
      <div className="slider-ends">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}
