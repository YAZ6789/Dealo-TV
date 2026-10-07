import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, ExternalLink, KeyRound, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useLibrary } from '../store/library';
import { useRecommendations } from '../hooks/useRecommendations';
import { useShowActions } from '../hooks/useShowActions';
import { askDealo, resolvePicks, tasteContext, ASSISTANT_MODEL, type ChatTurn, type ResolvedPick } from '../ai/assistant';
import { remember, showPath } from '../lib/showCache';
import { Poster } from '../components/Poster';
import { matchClass } from '../components/ShowCard';

interface Message extends ChatTurn {
  picks?: ResolvedPick[];
  error?: boolean;
}

const SUGGESTIONS = [
  'Something like Dark but funnier',
  'A short binge I can finish this weekend',
  'A hidden gem from Korea or Japan',
  'What should I watch tonight? I have about an hour.',
  'Something cozy and low-stakes',
  'Why do you think I liked Severance?',
];

const STORE = 'dealo:assistant';

function loadThread(): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as Message[];
  } catch {
    return [];
  }
}

export default function Assistant() {
  const apiKey = useSettings((s) => s.anthropicKey);
  const setKey = useSettings((s) => s.setAnthropicKey);
  const recs = useRecommendations();
  const actions = useShowActions();
  const entries = useLibrary((s) => s.entries);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [thread, setThread] = useState<Message[]>(loadThread);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(thread.slice(-30)));
    } catch {
      /* ignore */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !apiKey) return;
    setInput('');
    const history = thread.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setThread((t) => [...t, { role: 'user', text: q }]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const doc = useLibrary.getState().exportDoc();
      const answer = await askDealo({ apiKey, context: tasteContext(doc, recs.output), history, question: q, signal: abort.current.signal });
      const picks = await resolvePicks(answer.picks, recs.output);
      // The model's own JSON goes back into history so follow-ups ("more like the second one") work.
      const text = answer.reply + (answer.picks.length ? `\n\nSuggested: ${answer.picks.map((p) => `${p.title}${p.year ? ` (${p.year})` : ''}`).join('; ')}` : '');
      setThread((t) => [...t, { role: 'assistant', text, picks }]);
    } catch (err) {
      if (abort.current?.signal.aborted || (err as Error).name === 'AbortError') return;
      setThread((t) => [...t, { role: 'assistant', text: (err as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  // Voice control / command palette can hand us a question: /assistant?q=...
  const q = params.get('q');
  useEffect(() => {
    // Wait while a previous answer is still coming so the new question isn't dropped.
    if (q && apiKey && !busy) {
      setParams({}, { replace: true });
      void ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, apiKey, busy]);

  // Leaving the page cancels an in-flight (paid) request instead of letting it finish into the void.
  useEffect(() => () => abort.current?.abort(), []);

  if (!apiKey)
    return (
      <div className="page assistant">
        <div className="page-head">
          <div>
            <h1 className="page-title">Ask Dealo</h1>
            <p className="page-sub">Describe what you're in the mood for in plain words — “like Dark but funnier” — and get picks that fit your taste.</p>
          </div>
        </div>
        <div className="panel panel--pad stack assistant-setup">
          <div className="cluster">
            <KeyRound size={20} className="accent" />
            <strong>Connect Claude (one-time)</strong>
          </div>
          <ol className="setup-steps">
            <li>
              Create an API key at{' '}
              <a className="accent" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com <ExternalLink size={11} />
              </a>{' '}
              (add a few dollars of credit — each question costs about one or two cents).
            </li>
            <li>Paste it below. It's stored only in this browser and sent only to Anthropic.</li>
          </ol>
          <form
            className="key-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (keyDraft.trim()) setKey(keyDraft);
            }}
          >
            <input className="input mono" type="password" autoComplete="off" placeholder="sk-ant-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
            <button className="btn btn--primary" disabled={!keyDraft.trim()}>
              Save key
            </button>
          </form>
          <p className="hint">Uses {ASSISTANT_MODEL}. You can remove the key any time in Settings.</p>
        </div>
      </div>
    );

  return (
    <div className="page assistant">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ask Dealo</h1>
          <p className="page-sub">Knows your {Object.keys(entries).length} shows, your ratings and what you've ruled out.</p>
        </div>
        <div className="spacer" />
        {thread.length > 0 && (
          <button className="btn btn--sm btn--ghost" onClick={() => setThread([])}>
            <Trash2 size={14} /> New chat
          </button>
        )}
      </div>

      <div className="chat">
        {thread.length === 0 && (
          <div className="chat-empty">
            <Bot size={34} className="accent" />
            <p>Try one of these, or ask anything:</p>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {thread.map((m, i) => (
          <div key={i} className={`msg msg--${m.role} ${m.error ? 'msg--error' : ''}`}>
            {m.role === 'assistant' && <Sparkles size={16} className="msg__icon" />}
            <div className="msg__body">
              <p className="msg__text">{m.role === 'assistant' ? m.text.split('\n\nSuggested:')[0] : m.text}</p>
              {m.picks && m.picks.length > 0 && (
                <div className="picks">
                  {m.picks.map((p) => {
                    const inLib = p.show && entries[p.show.id];
                    return (
                      <div key={p.title} className="pick panel">
                        <button
                          className="pick__poster"
                          disabled={!p.show}
                          onClick={() => {
                            if (!p.show) return;
                            remember(p.show);
                            nav(showPath(p.show.id));
                          }}
                          aria-label={`Open ${p.title}`}
                        >
                          {p.show ? <Poster show={p.show} /> : <span className="faint">?</span>}
                        </button>
                        <div className="pick__main">
                          <div className="pick__title">
                            {p.show?.title ?? p.title}
                            {(p.show?.year ?? p.year) && <span className="faint"> · {p.show?.year ?? p.year}</span>}
                          </div>
                          {p.rec && !p.rec.exploratory && <span className={matchClass(p.rec.match)}>{p.rec.match}% match</span>}
                          <p className="pick__why">{p.why}</p>
                          <div className="cluster">
                            {p.show && !inLib && (
                              <button className="btn btn--sm" onClick={() => actions.watchlist(p.show!)}>
                                <Plus size={13} /> Watchlist
                              </button>
                            )}
                            {inLib && <span className="tag tag--accent">In your library</span>}
                            {!p.show && <span className="hint">Couldn't find this one in the show database</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="msg msg--assistant">
            <Sparkles size={16} className="msg__icon" />
            <div className="msg__body">
              <div className="typing" aria-label="Thinking">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="chat-input panel"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="What are you in the mood for?" aria-label="Ask Dealo" autoFocus />
        <button className="btn btn--primary btn--icon" disabled={busy || !input.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
      <p className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
        Answers come from Claude using your API key · <Link to="/settings">Settings</Link>
      </p>
    </div>
  );
}
