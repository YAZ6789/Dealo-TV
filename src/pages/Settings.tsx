import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CheckCircle2, MonitorDown, Share, Database, Download, ExternalLink, KeyRound, Link2, RotateCcw, Sparkles, Upload, XCircle } from 'lucide-react';
import { SITE_TMDB_KEY, useSettings } from '../store/settings';
import { useLibrary } from '../store/library';
import { createTmdb } from '../providers/tmdb';
import { clearCache } from '../providers/cache';
import { relinkToTmdb } from '../store/relink';
import { buildDemoDoc } from '../lib/demo';
import { relTime } from '../lib/labels';
import { DesignPicker, SkinPicker, TextSizePicker } from '../components/ThemeSwitcher';
import { toast } from '../components/toast';
import { voiceSupported } from '../voice/VoiceButton';
import { ASSISTANT_MODEL } from '../ai/assistant';
import { installApp, isIOS, usePwa } from '../pwa';
import { Attribution } from './Home';

const REGIONS = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'BR', 'MX', 'IN', 'JP', 'KR', 'ZA', 'AE', 'IL', 'PL', 'TR'];

export default function Settings() {
  const s = useSettings();
  const entries = useLibrary((x) => x.entries);
  const sources = useLibrary((x) => x.importSources);
  const updatedAt = useLibrary((x) => x.updatedAt);
  const [key, setKey] = useState(s.tmdbKey === SITE_TMDB_KEY ? '' : s.tmdbKey);
  const [checking, setChecking] = useState(false);
  const [aiKey, setAiKey] = useState(s.anthropicKey);
  const pwa = usePwa();
  const [relink, setRelink] = useState<{ done: number; total: number } | null>(null);
  const count = Object.keys(entries).length;
  const nonTmdb = useMemo(() => Object.keys(entries).filter((id) => !id.startsWith('tmdb:')).length, [entries]);
  const size = useMemo(() => {
    try {
      return Math.round((localStorage.getItem('dealo:library')?.length ?? 0) / 1024);
    } catch {
      return 0;
    }
  }, [updatedAt]);

  const saveKey = async () => {
    const k = key.trim();
    if (!k) {
      s.setTmdbKey(SITE_TMDB_KEY, undefined);
      setKey('');
      toast(SITE_TMDB_KEY ? 'Your key was removed — using the site’s TMDB key' : 'TMDB key removed — using the built-in catalog + TVmaze');
      return;
    }
    setChecking(true);
    const result = await createTmdb({ key: k, region: s.region }).check();
    setChecking(false);
    s.setTmdbKey(k, result === 'unreachable' ? undefined : result === 'ok');
    toast(
      result === 'ok'
        ? 'TMDB connected — live data and smarter recommendations unlocked'
        : result === 'rejected'
          ? 'That key was rejected by TMDB — check you copied all of it'
          : 'Saved, but TMDB is unreachable right now — it will be checked again next time',
    );
  };

  const exportBackup = () => {
    const doc = useLibrary.getState().exportDoc();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dealo-tv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="page settings">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Look & feel, data sources and your data.</p>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">Design</h2>
        <p className="section-sub">How you browse on Home. Every design works with every skin.</p>
        <DesignPicker />
      </section>

      <section className="section">
        <h2 className="section-title">Skin</h2>
        <p className="section-sub">Colours and typography. Each skin has its own switch-over effect.</p>
        <SkinPicker />
        <div className="toggle-row">
          <span className="label" style={{ minWidth: 90 }}>
            Text size
          </span>
          <TextSizePicker />
        </div>
        <Toggle on={s.reduceFx} set={s.setReduceFx} label="Reduce background effects (saves battery)" />
        <Toggle on={s.ambientColors} set={s.setAmbientColors} label="Show-coloured background — the page takes on the colours of the show you're looking at" />
      </section>

      <section className="section">
        <h2 className="section-title">Viewing</h2>
        <Toggle on={s.spoilerFree} set={s.setSpoilerFree} label="Spoiler-free mode — hide titles, descriptions and stills of episodes you haven't watched yet" />
        <Toggle
          on={s.voiceEnabled && voiceSupported}
          set={s.setVoiceEnabled}
          disabled={!voiceSupported}
          label={voiceSupported ? 'Voice control — mic button in the top bar (Alt+V). Try “switch to neon” or “add Severance to my watchlist”' : 'Voice control — not supported in this browser (use Chrome, Edge or Safari)'}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Ask Dealo (AI)</h2>
        <div className="panel panel--pad stack">
          <div className="cluster">
            <Bot size={18} className="accent" />
            {s.anthropicKey ? (
              <span className="tag tag--accent">
                <CheckCircle2 size={12} /> Connected
              </span>
            ) : (
              <span className="tag">Not set up</span>
            )}
          </div>
          <p className="dim" style={{ margin: 0 }}>
            Ask for shows in plain words — “like Dark but funnier”, “a short binge for this weekend” — and get picks that fit your taste. Uses your own Anthropic API key ({ASSISTANT_MODEL}); about one or two
            cents per question.
          </p>
          <div className="field">
            <label className="label" htmlFor="ai-key">
              Anthropic API key
            </label>
            <div className="key-row">
              <input id="ai-key" className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={aiKey} onChange={(e) => setAiKey(e.target.value)} />
              <button
                className="btn btn--primary"
                onClick={() => {
                  s.setAnthropicKey(aiKey);
                  toast(aiKey.trim() ? 'Ask Dealo is ready' : 'Anthropic key removed');
                }}
              >
                <KeyRound size={15} /> {aiKey.trim() ? 'Save' : 'Remove'}
              </button>
            </div>
            <span className="hint">
              Create one at{' '}
              <a className="accent" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com <ExternalLink size={10} />
              </a>
              . Stored only in this browser and sent only to Anthropic.{' '}
              {s.anthropicKey && (
                <Link className="accent" to="/assistant">
                  Open Ask Dealo →
                </Link>
              )}
            </span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Show data</h2>
        <div className="panel panel--pad stack">
          <div className="cluster">
            {s.tmdbKey && s.tmdbValid !== false ? (
              <span className="tag tag--accent">
                <CheckCircle2 size={12} /> TMDB connected{s.tmdbKey === SITE_TMDB_KEY ? ' (site key)' : ''}
              </span>
            ) : s.tmdbKey ? (
              <span className="tag" style={{ color: 'var(--danger)' }}>
                <XCircle size={12} /> TMDB key not working
              </span>
            ) : (
              <span className="tag">Built-in catalog (309 shows) + TVmaze</span>
            )}
          </div>
          <p className="dim" style={{ margin: 0 }}>
            Add a free TMDB key for every show ever made, real backdrops, trailers, where-to-stream, and recommendations powered by TMDB's “people also liked” data. Without one, Dealo uses its
            built-in catalog plus TVmaze (no key needed).
          </p>
          <div className="field">
            <label className="label" htmlFor="tmdb-key">
              TMDB API key or read-access token
            </label>
            <div className="key-row">
              <input
                id="tmdb-key"
                className="input mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="v3 key (32 chars) or v4 token (eyJ…)"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="btn btn--primary" onClick={() => void saveKey()} disabled={checking}>
                {checking ? <div className="spinner" /> : <KeyRound size={15} />} Save & test
              </button>
            </div>
            <span className="hint">
              Get one free: create an account at{' '}
              <a className="accent" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
                themoviedb.org/settings/api <ExternalLink size={10} />
              </a>{' '}
              → “API Read Access Token”. It's stored only in this browser.
            </span>
          </div>
          {s.tmdbKey && s.tmdbValid !== false && nonTmdb > 0 && (
            <div className="note">
              <Link2 size={16} />
              <span style={{ flex: 1 }}>
                {nonTmdb} shows in your library came from the catalog, TVmaze or your sheet. Re-link them to TMDB for posters, episodes and better recommendations.
              </span>
              <button
                className="btn btn--sm"
                disabled={!!relink}
                onClick={async () => {
                  setRelink({ done: 0, total: nonTmdb });
                  const r = await relinkToTmdb((done, total) => setRelink({ done, total }));
                  setRelink(null);
                  toast(`Re-linked ${r.moved} of ${r.total} shows to TMDB`);
                }}
              >
                {relink ? `${relink.done}/${relink.total}` : 'Re-link now'}
              </button>
            </div>
          )}
          <div className="field" style={{ maxWidth: 260 }}>
            <label className="label" htmlFor="region">
              Region (where-to-watch & ratings)
            </label>
            <select id="region" className="select" value={s.region} onChange={(e) => s.setRegion(e.target.value)}>
              {[...new Set([s.region, ...REGIONS])].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">App</h2>
        <div className="panel panel--pad stack">
          <div className="cluster">
            <MonitorDown size={18} className="accent" />
            <strong>{pwa.installed ? 'Installed as an app' : 'Install Dealo TV as an app'}</strong>
            {pwa.offline && <span className="tag">Offline</span>}
          </div>
          <p className="dim" style={{ margin: 0 }}>
            Opens in its own window or from your home screen, launches instantly and works offline — your library is stored on the device, so you can browse and tick episodes on a
            plane. Show data and posters you've already seen are cached.
          </p>
          {pwa.installed ? (
            <span className="hint">You're using the installed app. Updates install themselves — you'll see a “Reload” prompt when a new version is ready.</span>
          ) : pwa.canInstall ? (
            <div className="cluster">
              <button className="btn btn--primary btn--sm" onClick={() => void installApp()}>
                <MonitorDown size={14} /> Install app
              </button>
            </div>
          ) : isIOS() ? (
            <span className="hint">
              On iPhone/iPad: tap <Share size={12} /> Share in Safari, then “Add to Home Screen”.
            </span>
          ) : (
            <span className="hint">In Chrome or Edge use the install icon in the address bar (or menu → “Install Dealo TV”). On Android: menu → “Add to Home screen”.</span>
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Your data</h2>
        <div className="two-col">
          <div className="panel panel--pad stack">
            <div className="cluster">
              <Database size={18} className="accent" />
              <strong>Stored in this browser</strong>
            </div>
            <p className="dim" style={{ margin: 0 }}>
              {count} shows · {size} KB · last change {relTime(updatedAt)}. Nothing leaves your device. Export a backup to move between browsers — cloud sync can be plugged in later
              (see README).
            </p>
            <div className="cluster">
              <button className="btn btn--sm" onClick={exportBackup}>
                <Download size={14} /> Export backup
              </button>
              <Link className="btn btn--sm" to="/settings/import">
                <Upload size={14} /> Import / restore
              </Link>
            </div>
            {sources.length > 0 && <span className="hint">{sources.length} connected Google Sheet{sources.length > 1 ? 's' : ''} — re-sync from Import.</span>}
          </div>
          <div className="panel panel--pad stack">
            <div className="cluster">
              <Sparkles size={18} className="accent" />
              <strong>Try it out</strong>
            </div>
            <p className="dim" style={{ margin: 0 }}>
              Load a sample library (24 shows with ratings, progress and a year of watch history) to explore every screen. This replaces your current library.
            </p>
            <div className="cluster">
              <button
                className="btn btn--sm"
                onClick={() => {
                  if (count && !confirm(`Replace your ${count} shows with the demo library? Export a backup first if you want to keep them.`)) return;
                  useLibrary.getState().replaceDoc(buildDemoDoc());
                  s.setOnboarded(true);
                  toast('Demo library loaded');
                }}
              >
                <Sparkles size={14} /> Load demo library
              </button>
              <button
                className="btn btn--sm btn--danger"
                onClick={async () => {
                  if (!confirm('Delete your entire library, ratings and taste profile from this browser?')) return;
                  if (!confirm('Really? This cannot be undone (unless you exported a backup).')) return;
                  useLibrary.getState().reset();
                  await clearCache();
                  toast('Everything reset');
                }}
              >
                <RotateCcw size={14} /> Reset everything
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Shortcuts</h2>
        <div className="panel panel--pad shortcuts">
          {[
            ['Ctrl/⌘ K or /', 'Search & commands'],
            ['Alt + D', 'Next design'],
            ['Alt + T', 'Next skin'],
            ['Alt + V', 'Voice command'],
            ['← →', 'Spin the Holo Ring'],
            ['↑ ↓', 'Fly through the Warp Tunnel · change channel'],
            ['Z', 'Undo the last swipe (Swipe Deck)'],
            ['0–9 · G', 'Tune a channel · open the guide (Channel Surfer)'],
            ['+ − 0', 'Zoom · fit the Life Timeline'],
            ['Enter', 'Open the focused show'],
            ['Shift + Enter', 'Add search result to watchlist'],
          ].map(([k, v]) => (
            <div key={k}>
              <kbd>{k}</kbd> <span className="dim">{v}</span>
            </div>
          ))}
        </div>
      </section>
      <Attribution />
    </div>
  );
}

function Toggle({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <div className="toggle-row">
      <button className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on} aria-label={label} disabled={disabled} />
      <span className={disabled ? 'faint' : undefined}>{label}</span>
    </div>
  );
}
