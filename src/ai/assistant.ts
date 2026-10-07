import Anthropic from '@anthropic-ai/sdk';
import type { LibraryDoc, Recommendation, ShowSummary } from '../types';
import type { EngineOutput } from '../recommend/engine';
import { GENRE_LABELS } from '../lib/genres';
import { STATUS_LABEL } from '../lib/labels';
import { titleSimilarity } from '../lib/text';
import { searchShows } from '../providers';

/**
 * "Ask Dealo" — natural-language recommendations with Claude.
 *
 * Runs entirely in the browser with the user's own Anthropic API key (Settings),
 * so the site stays static. The model gets a compact taste summary, the titles
 * already in the library (so it doesn't suggest them) and the on-device
 * engine's top candidates as grounding, and answers in a fixed JSON shape.
 * Each pick is then resolved to a real show via the metadata providers.
 */

export const ASSISTANT_MODEL = 'claude-opus-5-5';

export interface AssistantPick {
  title: string;
  year?: number;
  why: string;
}

export interface AssistantAnswer {
  reply: string;
  picks: AssistantPick[];
}

export interface ResolvedPick extends AssistantPick {
  show?: ShowSummary;
  rec?: Recommendation;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Conversational answer, 1–4 sentences, no lists.' },
    picks: {
      type: 'array',
      description: 'Specific TV shows to suggest (0–8). Empty if the user did not ask for shows.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          year: { type: 'integer', description: 'First air year, if known.' },
          why: { type: 'string', description: 'One sentence tying it to this user’s taste or request.' },
        },
        required: ['title', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'picks'],
  additionalProperties: false,
} as const;

/** A compact, stable description of the user's taste for the system prompt. */
export function tasteContext(doc: LibraryDoc, out?: EngineOutput): string {
  const entries = Object.values(doc.entries);
  const line = (title: string, year?: number) => (year ? `${title} (${year})` : title);
  const loved = entries
    .filter((e) => (e.rating ?? 0) >= 8 || e.favorite)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 25)
    .map((e) => `${line(e.show.title, e.show.year)}${e.rating ? ` — ${e.rating}/10` : ''}`);
  const disliked = entries
    .filter((e) => e.status === 'dropped' || (e.rating != null && e.rating <= 4))
    .slice(0, 15)
    .map((e) => line(e.show.title, e.show.year));
  const watching = entries.filter((e) => e.status === 'watching').map((e) => e.show.title);
  const known = entries.map((e) => e.show.title);
  const blocked = Object.values(doc.blocked).map((b) => b.show.title);
  const likeGenres = Object.entries(doc.taste.genres)
    .filter(([, v]) => v > 0)
    .map(([g]) => GENRE_LABELS[g as keyof typeof GENRE_LABELS]);
  const avoidGenres = Object.entries(doc.taste.genres)
    .filter(([, v]) => v < 0)
    .map(([g]) => GENRE_LABELS[g as keyof typeof GENRE_LABELS]);
  const traits = out?.traits.slice(0, 12).map((t) => t.label) ?? [];
  const candidates =
    out?.ranked.slice(0, 60).map((r) => `${line(r.show.title, r.show.year)} — ${r.match}% match · ${r.show.genres.map((g) => GENRE_LABELS[g]).join('/')}`) ?? [];

  return [
    `Taste traits learned from their library: ${traits.join(', ') || 'unknown yet'}.`,
    likeGenres.length ? `Genres they told us they love: ${likeGenres.join(', ')}.` : '',
    avoidGenres.length ? `Genres they avoid: ${avoidGenres.join(', ')}.` : '',
    `Loved / highly rated: ${loved.join('; ') || 'none yet'}.`,
    `Disliked or dropped: ${disliked.join('; ') || 'none'}.`,
    `Currently watching: ${watching.join('; ') || 'nothing'}.`,
    `Already in their library (never suggest these): ${known.join('; ') || 'nothing'}.`,
    `Marked "not interested" (never suggest these): ${blocked.join('; ') || 'nothing'}.`,
    `Top candidates from the on-device recommender (good grounding, but you may go beyond them): ${candidates.join('; ') || 'none'}.`,
    `Their list statuses use these names: ${Object.values(STATUS_LABEL).join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM = `You are Dealo, the built-in TV-show concierge inside a personal TV tracker. You know television deeply — shows from every country and era, creators, tone, pacing, what each show feels like to watch.

Answer the user's request using their taste profile below. When they ask for something to watch, suggest specific, real TV series (not films) that genuinely fit both the request and their taste, prefer shows they're unlikely to know if they ask for surprises, and never suggest anything already in their library or marked not interested. Each "why" should connect to their actual taste or request in one concrete sentence. Keep "reply" short and warm; put the shows in "picks", not in the reply text. If they ask a question that isn't about choosing shows, answer it in "reply" and leave "picks" empty.`;

export class AssistantError extends Error {}

export async function askDealo(opts: { apiKey: string; context: string; history: ChatTurn[]; question: string; signal?: AbortSignal }): Promise<AssistantAnswer> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...opts.history.slice(-10).map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.BetaMessageParam),
    { role: 'user', content: opts.question },
  ];
  try {
    const response = await client.beta.messages.create(
      {
        model: ASSISTANT_MODEL,
        max_tokens: 16000,
        // Server-side fallback: if a safety classifier declines, Anthropic re-runs on its recommended model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Conversational recommendations: low effort keeps answers fast.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
        system: [
          { type: 'text', text: SYSTEM },
          { type: 'text', text: `About this user:\n${opts.context}`, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      },
      { signal: opts.signal },
    );
    if (response.stop_reason === 'refusal') throw new AssistantError("Claude declined that request. Try asking about shows in a different way.");
    if (response.stop_reason === 'max_tokens') throw new AssistantError('The answer was cut off — try a more specific request.');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = JSON.parse(text) as AssistantAnswer;
    return { reply: parsed.reply ?? '', picks: Array.isArray(parsed.picks) ? parsed.picks.slice(0, 8) : [] };
  } catch (err) {
    if (err instanceof AssistantError) throw err;
    if (err instanceof Anthropic.APIUserAbortError) throw err; // cancelled by the page — not an error to show
    if (err instanceof Anthropic.AuthenticationError) throw new AssistantError('Your Anthropic API key was rejected — check it in Settings → Ask Dealo.');
    if (err instanceof Anthropic.RateLimitError) throw new AssistantError('Rate limited by the Anthropic API — wait a moment and try again.');
    if (err instanceof Anthropic.APIError) throw new AssistantError(`Anthropic API error ${err.status ?? ''}: ${err.message}`);
    if (err instanceof SyntaxError) throw new AssistantError('Got an unexpected answer format — please try again.');
    throw err;
  }
}

/** Turn model picks into real shows: prefer the engine's candidates, else search the providers. */
export async function resolvePicks(picks: AssistantPick[], out?: EngineOutput): Promise<ResolvedPick[]> {
  return Promise.all(
    picks.map(async (p): Promise<ResolvedPick> => {
      const fromEngine = out?.ranked.find((r) => titleSimilarity(r.show.title, p.title) > 0.92 && (!p.year || !r.show.year || Math.abs(r.show.year - p.year) <= 1));
      if (fromEngine) return { ...p, show: fromEngine.show, rec: fromEngine };
      try {
        const hits = await searchShows(p.title, p.year);
        const best = hits.find((h) => titleSimilarity(h.title, p.title) > 0.85) ?? hits[0];
        return { ...p, show: best, rec: best && out ? out.score(best) : undefined };
      } catch {
        return p;
      }
    }),
  );
}
