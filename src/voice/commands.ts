import type { DesignId, ThemeId } from '../store/settings';
import type { WatchStatus } from '../types';

/**
 * Turns a spoken phrase into an app command. Pure, so it can be unit tested;
 * the VoiceButton executes the result. Anything we don't understand becomes
 * an "ask" (sent to the AI assistant when it's set up, otherwise a search).
 */

export type VoiceCommand =
  | { kind: 'navigate'; path: string; label: string }
  | { kind: 'key'; key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Escape'; label: string }
  | { kind: 'step'; dir: 1 | -1 }
  | { kind: 'skin'; id: ThemeId }
  | { kind: 'mode'; mode: 'light' | 'dark' }
  | { kind: 'design'; id: DesignId }
  | { kind: 'search'; query: string }
  | { kind: 'openShow'; query: string }
  | { kind: 'setStatus'; query: string; status: WatchStatus }
  | { kind: 'ask'; text: string };

const PAGES: [RegExp, string, string][] = [
  [/^(home|the home ?page|start)$/, '/', 'Home'],
  [/^(discover|recommendations|for you)$/, '/discover', 'Discover'],
  [/^(library|my library|my shows)$/, '/library', 'Library'],
  [/^(watchlist|my watchlist|watch list)$/, '/library/plan', 'Watchlist'],
  [/^(watched|history|finished)$/, '/library/completed', 'Watched'],
  [/^(stats|statistics)$/, '/stats', 'Stats'],
  [/^(taste|taste profile|my taste)$/, '/taste', 'Taste'],
  [/^(settings|preferences)$/, '/settings', 'Settings'],
  [/^(airing|upcoming|calendar|schedule|new episodes)$/, '/upcoming', 'Airing'],
  [/^(wrapped|my wrapped|year in review)$/, '/wrapped', 'Wrapped'],
  [/^(assistant|ask dealo|ai|chat)$/, '/assistant', 'Ask Dealo'],
  [/^(import|google sheets?|my sheet)$/, '/settings/import', 'Import'],
];

const SKINS: [RegExp, ThemeId][] = [
  [/\b(cyan|hud|hologra\w*)\b/, 'hud'],
  [/\bneon\b|\bcyberpunk\b/, 'neon'],
  [/\baurora\b/, 'aurora'],
  [/\b(phosphor|terminal|matrix|green)\b/, 'terminal'],
  [/\b(high contrast|contrast)\b/, 'contrast'],
];

const DESIGNS: [RegExp, DesignId][] = [
  [/\b(person of interest|the machine|machine|surveillance|cctv|poi)\b/, 'poi'],
  [/\b(holo ?ring|ring|carousel)\b/, 'ring'],
  [/\b(constellation|star ?map|stars)\b/, 'constellation'],
  [/\b(warp|tunnel)\b/, 'tunnel'],
  [/\b(channel|surfer|tv|television)\b/, 'channel'],
  [/\b(stream|classic|rows)\b/, 'stream'],
];

const STATUS: [RegExp, WatchStatus][] = [
  [/watch ?list|later|want to watch|to watch/, 'plan'],
  [/watched|seen|finished|completed|done/, 'completed'],
  [/watching|currently/, 'watching'],
  [/on hold|paused|hold/, 'on_hold'],
  [/dropped|quit|gave up/, 'dropped'],
];

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hey |ok |okay )?dealo,? /, '')
    .replace(/^(please |can you |could you )/, '')
    .replace(/ please$/, '');

export function parseVoice(raw: string): VoiceCommand {
  const t = clean(raw);
  if (!t) return { kind: 'ask', text: raw };

  // stepping / keys
  if (/^(next|next one|skip)$/.test(t)) return { kind: 'step', dir: 1 };
  if (/^(previous|back|go back|last one|prev)$/.test(t)) return { kind: 'step', dir: -1 };
  for (const [re, key, label] of [
    [/^(left|go left)$/, 'ArrowLeft', 'Left'],
    [/^(right|go right)$/, 'ArrowRight', 'Right'],
    [/^(up|go up|channel up)$/, 'ArrowUp', 'Up'],
    [/^(down|go down|channel down)$/, 'ArrowDown', 'Down'],
    [/^(select|select it|open it|enter|okay|ok|play|this one|details)$/, 'Enter', 'Select'],
    [/^(close|cancel|escape|exit)$/, 'Escape', 'Close'],
  ] as const)
    if (re.test(t)) return { kind: 'key', key, label };

  // light / dark: "light mode", "turn on dark mode", "make it brighter"
  if (/\b(light|daylight|bright(er)?)( mode| theme)?\b/.test(t) && /\b(mode|theme|switch|turn|use|make|go)\b/.test(t) && !/\bdark\b/.test(t)) return { kind: 'mode', mode: 'light' };
  if (/\bdark( mode| theme)?\b/.test(t) && /\b(mode|theme|switch|turn|use|make|go)\b/.test(t)) return { kind: 'mode', mode: 'dark' };

  // skins & designs: "switch to neon", "neon skin", "use the tunnel design"
  const themeLike = /\b(skin|theme|colou?rs?|mode)\b/.test(t);
  const designLike = /\b(design|layout|view)\b/.test(t);
  const switchLike = /^(switch|change|use|go|set|turn)( it)?( (to|on))?\b/.test(t) || themeLike || designLike;
  if (switchLike) {
    if (!designLike) for (const [re, id] of SKINS) if (re.test(t)) return { kind: 'skin', id };
    if (!themeLike) for (const [re, id] of DESIGNS) if (re.test(t)) return { kind: 'design', id };
  }

  // navigation: "go to stats", "open my watchlist", "show settings"
  const nav = /^(go to|open|show( me)?|take me to|navigate to)( the| my)? (.+?)( page| tab| screen)?$/.exec(t);
  if (nav) {
    const target = nav[4].trim();
    for (const [re, path, label] of PAGES) if (re.test(target)) return { kind: 'navigate', path, label };
  }
  for (const [re, path, label] of PAGES) if (re.test(t)) return { kind: 'navigate', path, label };

  // list changes: "add severance to my watchlist", "mark dark as watched", "i'm watching the bear"
  // Greedy title + status phrase anchored at the end, so "mark Lost in Space as watched" keeps the whole title.
  const add = /^(add|put|move|mark|set)( the show)? (.+) (to|as|on|in|into)( my| the)? ((?:watch ?list|later|want to watch|to watch|watched|seen|finished|completed|done|watching|currently watching|on hold|paused|hold|dropped|quit|gave up)(?: list)?)$/.exec(t);
  if (add) {
    for (const [re, status] of STATUS) if (re.test(add[6])) return { kind: 'setStatus', query: add[3], status };
  }
  const watchingNow = /^(i'?m|i am) (now )?watching (.+)$/.exec(t);
  if (watchingNow) return { kind: 'setStatus', query: watchingNow[3], status: 'watching' };
  const finished = /^(i )?(finished|watched|completed) (.+)$/.exec(t);
  if (finished) return { kind: 'setStatus', query: finished[3], status: 'completed' };

  // search / open a show
  const search = /^(search( for)?|find|look up|look for) (.+)$/.exec(t);
  if (search) return { kind: 'search', query: search[3] };
  const open = /^(open|show( me)?|play|go to) (.+)$/.exec(t);
  if (open) return { kind: 'openShow', query: open[3] };

  return { kind: 'ask', text: raw.trim() };
}
