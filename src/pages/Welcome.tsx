import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Heart, Meh, Sheet, Sparkles, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import type { GenreKey, ShowSummary, WatchStatus } from '../types';
import { useSettings } from '../store/settings';
import { useLibrary } from '../store/library';
import { allCatalog, getCatalogShow } from '../providers/catalog';
import { GENRE_LABELS, PRIMARY_GENRES } from '../lib/genres';
import { buildDemoDoc } from '../lib/demo';
import { DesignPicker, SkinPicker } from '../components/ThemeSwitcher';
import { Logo } from '../components/Logo';
import { Poster } from '../components/Poster';

type Answer = { status: WatchStatus; rating?: number } | 'skip';

const ANSWERS: { key: string; label: string; icon: typeof Heart; value: Answer }[] = [
  { key: 'love', label: 'Loved it', icon: Heart, value: { status: 'completed', rating: 9 } },
  { key: 'like', label: 'Liked it', icon: ThumbsUp, value: { status: 'completed', rating: 7 } },
  { key: 'meh', label: 'Meh', icon: Meh, value: { status: 'completed', rating: 5 } },
  { key: 'no', label: 'Didn’t like', icon: ThumbsDown, value: { status: 'dropped', rating: 3 } },
  { key: 'want', label: 'Want to watch', icon: Clock, value: { status: 'plan' } },
  { key: 'skip', label: 'Haven’t seen', icon: X, value: 'skip' },
];

/** A diverse set of very well-known shows: the top of each major genre. */
function calibrationSet(): ShowSummary[] {
  const pool = [...allCatalog()].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const out: ShowSummary[] = [];
  const perGenre = new Map<string, number>();
  for (const s of pool) {
    const g = s.genres[0];
    if ((perGenre.get(g) ?? 0) >= 3) continue;
    perGenre.set(g, (perGenre.get(g) ?? 0) + 1);
    out.push(s);
    if (out.length >= 24) break;
  }
  return out;
}

export default function Welcome() {
  const [step, setStep] = useState(0);
  const nav = useNavigate();
  const setOnboarded = useSettings((s) => s.setOnboarded);
  const finish = (to = '/') => {
    setOnboarded(true);
    nav(to);
  };

  return (
    <div className="welcome">
      <div className="welcome__top">
        <Logo />
        <button className="btn btn--ghost btn--sm" onClick={() => finish()}>
          Skip setup
        </button>
      </div>

      {step === 0 && (
        <section className="welcome__step">
          <div className="boot mono" aria-hidden>
            <span>&gt; initialising viewing core</span>
            <span>&gt; loading 309-show knowledge base … ok</span>
            <span>&gt; recommendation engine … online</span>
          </div>
          <h1 className="hero__title welcome__title">Your shows. Your universe.</h1>
          <p className="page-sub welcome__lead">Track everything you've watched, what you're in the middle of, and what's next — with recommendations that actually learn your taste. First, pick how it should look.</p>
          <h2 className="section-title">Choose a design</h2>
          <DesignPicker />
          <h2 className="section-title" style={{ marginTop: 26 }}>
            Choose a skin
          </h2>
          <SkinPicker />
          <div className="welcome__foot">
            <span className="hint">You can change both any time from the palette icon (top right).</span>
            <button className="btn btn--primary" onClick={() => setStep(1)}>
              Continue <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="welcome__step">
          <h1 className="hero__title welcome__title">Bring your history</h1>
          <p className="page-sub welcome__lead">The more Dealo knows, the sharper it gets. Pick a starting point:</p>
          <div className="welcome__choices">
            <button className="panel panel--pad choice" onClick={() => finish('/settings/import')}>
              <Sheet size={30} className="accent" />
              <strong>Import my Google Sheet</strong>
              <span>Paste the link — columns, statuses, ratings and “S2E5”-style progress are detected automatically. Excel & CSV work too.</span>
            </button>
            <button className="panel panel--pad choice" onClick={() => setStep(2)}>
              <Heart size={30} className="accent" />
              <strong>Calibrate in 60 seconds</strong>
              <span>Pick the genres you like and react to a couple dozen well-known shows.</span>
            </button>
            <button
              className="panel panel--pad choice"
              onClick={() => {
                useLibrary.getState().replaceDoc(buildDemoDoc());
                finish();
              }}
            >
              <Sparkles size={30} className="accent" />
              <strong>Explore with demo data</strong>
              <span>A sample library with history and stats, so you can see every screen first. Replace it later.</span>
            </button>
          </div>
        </section>
      )}

      {step === 2 && <Calibrate onDone={() => finish()} />}
    </div>
  );
}

function Calibrate({ onDone }: { onDone: () => void }) {
  const shows = useMemo(calibrationSet, []);
  const taste = useLibrary((s) => s.taste.genres);
  const { setGenre, add } = useLibrary.getState();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = Object.values(answers).filter((a) => a !== 'skip').length;

  const save = () => {
    for (const s of shows) {
      const key = answers[s.id];
      const a = ANSWERS.find((x) => x.key === key)?.value;
      if (!a || a === 'skip') continue;
      add(s, a.status, { rating: a.rating, origin: 'calibration', seasonSizes: getCatalogShow(s.id.slice(4))?.seasons });
    }
    onDone();
  };

  return (
    <section className="welcome__step">
      <h1 className="hero__title welcome__title">Calibrate your taste</h1>
      <h2 className="section-title">Genres — tap to love, again to avoid</h2>
      <div className="chips">
        {PRIMARY_GENRES.slice(0, 22).map((g: GenreKey) => {
          const v = taste[g];
          return (
            <button key={g} className={`chip ${v === 1 ? 'chip--on' : v === -1 ? 'chip--off' : ''}`} onClick={() => setGenre(g, v === 1 ? -1 : v === -1 ? 0 : 1)}>
              {v === 1 ? '♥ ' : v === -1 ? '⊘ ' : ''}
              {GENRE_LABELS[g]}
            </button>
          );
        })}
      </div>

      <h2 className="section-title" style={{ marginTop: 30 }}>
        Seen any of these? <span className="count">{answered} rated</span>
      </h2>
      <div className="calib-grid">
        {shows.map((s) => (
          <div key={s.id} className={`calib ${answers[s.id] ? `calib--${answers[s.id]}` : ''}`}>
            <div className="calib__poster">
              <Poster show={s} />
            </div>
            <div className="calib__title">{s.title}</div>
            <div className="calib__btns">
              {ANSWERS.map((a) => (
                <button
                  key={a.key}
                  className={answers[s.id] === a.key ? 'on' : ''}
                  title={a.label}
                  aria-label={`${a.label}: ${s.title}`}
                  onClick={() => setAnswers((x) => ({ ...x, [s.id]: x[s.id] === a.key ? '' : a.key }))}
                >
                  <a.icon size={14} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="welcome__foot sticky">
        <span className="hint">{answered < 5 ? 'Rate at least 5 for good recommendations' : 'Great — that’s plenty to start with'}</span>
        <button className="btn btn--primary" onClick={save}>
          Start watching <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}
