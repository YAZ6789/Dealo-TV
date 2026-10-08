import { Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { BackgroundFX } from './components/BackgroundFX';
import { AmbientLayer } from './components/AmbientLayer';
import { CommandPalette } from './components/CommandPalette';
import { Toasts } from './components/Toasts';
import { usePalette } from './components/palette';
import { useHotkeys } from './hooks/useHotkeys';
import { cycleTheme, switchDesign } from './theme/switch';
import { DESIGN_IDS } from './store/settings';
import { initLibrary, useLibrary } from './store/library';
import { useSettings } from './store/settings';
import { scheduleRecommendations } from './recommend/pipeline';
import { enrichLibrary } from './store/enrich';
import { backfillLibraryArtwork } from './providers/artwork';
import { startSheetAutoSync } from './store/sheetSync';
import { HomeRouter } from './designs/HomeRouter';
import { lazyRoute } from './lib/lazyRoute';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { notifyPref, useAiringNotifications } from './components/NewEpisodesBanner';
import { useUpcoming } from './hooks/useUpcoming';

const Discover = lazyRoute(() => import('./pages/Discover'));
const Library = lazyRoute(() => import('./pages/Library'));
const Show = lazyRoute(() => import('./pages/Show'));
const Stats = lazyRoute(() => import('./pages/Stats'));
const Taste = lazyRoute(() => import('./pages/Taste'));
const Settings = lazyRoute(() => import('./pages/Settings'));
const Import = lazyRoute(() => import('./pages/Import'));
const Welcome = lazyRoute(() => import('./pages/Welcome'));
const Wrapped = lazyRoute(() => import('./pages/Wrapped'));
const Upcoming = lazyRoute(() => import('./pages/Upcoming'));
const Assistant = lazyRoute(() => import('./pages/Assistant'));

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }), [pathname]);
  return null;
}

/** With airing alerts switched on, check for new episodes from any page (hourly, cached). */
function AiringWatcher() {
  useUpcoming();
  useAiringNotifications();
  return null;
}

function Shell() {
  const setPalette = usePalette((s) => s.setOpen);
  const onboarded = useSettings((s) => s.onboarded);
  const hydrated = useLibrary((s) => s.hydrated);
  const hasLibrary = useLibrary((s) => Object.keys(s.entries).length > 0);
  const { pathname } = useLocation();

  useHotkeys({
    'mod+k': () => setPalette(!usePalette.getState().open),
    '/': () => setPalette(true),
    'alt+t': () => cycleTheme(1),
    'alt+d': () => {
      const cur = useSettings.getState().design;
      switchDesign(DESIGN_IDS[(DESIGN_IDS.indexOf(cur) + 1) % DESIGN_IDS.length]);
    },
  });

  if (hydrated && !onboarded && !hasLibrary && pathname === '/') return <Navigate to="/welcome" replace />;

  return (
    <div className="app">
      <BackgroundFX />
      <AmbientLayer />
      {notifyPref() && <AiringWatcher />}
      <div className="vt-scanbar" aria-hidden />
      {pathname !== '/welcome' && <TopBar />}
      <main className="main">
        <RouteErrorBoundary resetKey={pathname}>
        <Suspense fallback={<div className="page"><div className="spinner" /></div>}>
          <Routes>
            <Route path="/" element={<HomeRouter />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/:tab" element={<Library />} />
            <Route path="/show/:id" element={<Show />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/taste" element={<Taste />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/import" element={<Import />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/wrapped" element={<Wrapped />} />
            <Route path="/wrapped/:year" element={<Wrapped />} />
            <Route path="/upcoming" element={<Upcoming />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        </RouteErrorBoundary>
      </main>
      <CommandPalette />
      <Toasts />
    </div>
  );
}

/** Check an unverified key once (e.g. the site key from the deploy secret); offline leaves it unverified. */
async function verifyTmdbKey() {
  const { tmdbKey, tmdbValid, region, setTmdbKey } = useSettings.getState();
  if (!tmdbKey || tmdbValid !== undefined) return;
  const { createTmdb } = await import('./providers/tmdb');
  const result = await createTmdb({ key: tmdbKey, region }).check();
  if (result !== 'unreachable' && useSettings.getState().tmdbKey === tmdbKey) setTmdbKey(tmdbKey, result === 'ok');
}

export default function App() {
  useEffect(() => {
    void verifyTmdbKey();
    void initLibrary().then(() => {
      setTimeout(() => void enrichLibrary(), 4000);
      setTimeout(backfillLibraryArtwork, 1500);
      startSheetAutoSync();
    });
    // Re-rank whenever the library changes (debounced; network parts are cached).
    return useLibrary.subscribe((s, prev) => {
      if (s.hydrated && (s.entries !== prev.entries || s.blocked !== prev.blocked || s.feedback !== prev.feedback || s.taste !== prev.taste)) scheduleRecommendations();
    });
  }, []);
  // Text size (Settings → Appearance): scales every rem-based size.
  const textScale = useSettings((s) => s.textScale);
  useEffect(() => {
    document.documentElement.style.fontSize = `${Math.round((textScale || 1) * 100)}%`;
  }, [textScale]);
  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (s.tmdbKey !== prev.tmdbKey || s.tmdbValid !== prev.tmdbValid) scheduleRecommendations(100);
      }),
    [],
  );
  return (
    <HashRouter>
      <ScrollReset />
      <Shell />
    </HashRouter>
  );
}
