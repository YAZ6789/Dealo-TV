import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useLibrary } from '../store/library';
import { searchShows } from '../providers';
import { titleSimilarity } from '../lib/text';
import { remember, showPath } from '../lib/showCache';
import { STATUS_LABEL } from '../lib/labels';
import { THEMES, DESIGNS } from '../theme/themes';
import { switchDesign, switchTheme } from '../theme/switch';
import { usePalette } from '../components/palette';
import { toast } from '../components/toast';
import { useHotkeys } from '../hooks/useHotkeys';
import { parseVoice, type VoiceCommand } from './commands';

/* Minimal typings for the Web Speech API (not in TS's DOM lib everywhere). */
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}
interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognizerCtor = new () => Recognizer;

const SR: RecognizerCtor | undefined =
  typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognizerCtor }).webkitSpeechRecognition) : undefined;

export const voiceSupported = !!SR;

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

async function findShow(query: string) {
  const lib = Object.values(useLibrary.getState().entries).find((e) => titleSimilarity(e.show.title, query) > 0.86);
  if (lib) return lib.show;
  const hits = await searchShows(query);
  return hits.find((h) => titleSimilarity(h.title, query) > 0.8) ?? hits[0];
}

export function VoiceButton() {
  const enabled = useSettings((s) => s.voiceEnabled);
  const nav = useNavigate();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const rec = useRef<Recognizer | null>(null);

  const run = async (cmd: VoiceCommand, raw: string) => {
    const s = useSettings.getState();
    switch (cmd.kind) {
      case 'navigate':
        nav(cmd.path);
        toast(`🎙 ${cmd.label}`);
        return;
      case 'key':
        press(cmd.key);
        return;
      case 'step': {
        // "next" means different keys in different designs.
        const onHome = location.hash === '#/' || location.hash === '';
        const d = s.design;
        const key = !onHome ? (cmd.dir > 0 ? 'ArrowRight' : 'ArrowLeft') : d === 'channel' ? (cmd.dir > 0 ? 'ArrowUp' : 'ArrowDown') : d === 'swipe' ? (cmd.dir > 0 ? 'ArrowDown' : 'z') : d === 'tunnel' ? (cmd.dir > 0 ? 'ArrowDown' : 'ArrowUp') : cmd.dir > 0 ? 'ArrowRight' : 'ArrowLeft';
        press(key);
        return;
      }
      case 'skin':
        switchTheme(cmd.id);
        toast(`🎙 Skin: ${THEMES[cmd.id].name}`);
        return;
      case 'design':
        if (location.hash !== '#/') nav('/');
        switchDesign(cmd.id);
        toast(`🎙 Design: ${DESIGNS[cmd.id].name}`);
        return;
      case 'search':
        usePalette.getState().setOpen(true, cmd.query);
        return;
      case 'openShow': {
        const show = await findShow(cmd.query);
        if (!show) return toast(`🎙 Couldn't find “${cmd.query}”`);
        remember(show);
        nav(showPath(show.id));
        return;
      }
      case 'setStatus': {
        const show = await findShow(cmd.query);
        if (!show) return toast(`🎙 Couldn't find “${cmd.query}”`);
        const lib = useLibrary.getState();
        if (lib.entries[show.id]) lib.setStatus(show.id, cmd.status);
        else lib.add(show, cmd.status);
        toast(`🎙 ${show.title} → ${STATUS_LABEL[cmd.status]}`);
        return;
      }
      case 'ask':
        if (s.anthropicKey) nav(`/assistant?q=${encodeURIComponent(cmd.text)}`);
        else usePalette.getState().setOpen(true, raw);
        return;
    }
  };

  const stop = () => rec.current?.stop();

  const start = () => {
    if (!SR) return toast('Voice control needs Chrome, Edge or Safari');
    if (rec.current) return stop();
    const r = new SR();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      setHeard(text);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access was blocked — allow it in your browser to use voice');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Voice error: ${e.error}`);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const text = finalText.trim();
      setTimeout(() => setHeard(''), 1200);
      if (text) void run(parseVoice(text), text);
    };
    rec.current = r;
    setHeard('');
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
    }
  };

  useHotkeys({ 'alt+v': () => enabled && SR && start() }, [enabled]);
  useEffect(() => () => rec.current?.stop(), []);

  if (!enabled || !SR) return null;
  return (
    <>
      <button className={`icon-btn voice-btn ${listening ? 'on listening' : ''}`} onClick={start} aria-label={listening ? 'Stop listening' : 'Voice command (Alt+V)'} title="Voice command (Alt+V)" aria-pressed={listening}>
        {listening ? <MicOff size={19} /> : <Mic size={19} />}
      </button>
      {(listening || heard) &&
        createPortal(
          <div className="voice-hud" role="status" aria-live="polite">
            <span className={`voice-hud__dot ${listening ? 'on' : ''}`} />
            <span className="voice-hud__text">{heard || 'Listening… try “switch to neon”, “add Severance to my watchlist”, “go to stats”'}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
