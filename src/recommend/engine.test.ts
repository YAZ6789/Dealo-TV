import { describe, expect, it } from 'vitest';
import type { LibraryEntry, ShowSummary, TasteProfile, WatchStatus } from '../types';
import { recommend, type EngineInput } from './engine';
import { buildShelves } from './shelves';
import { entryAffinity } from './profile';

const show = (id: string, title: string, o: Partial<ShowSummary> = {}): ShowSummary => ({
  id,
  source: 'catalog',
  title,
  genres: ['drama'],
  keywords: [],
  rating: 7.5,
  votes: 5000,
  popularity: 50,
  language: 'en',
  year: 2015,
  seasonCount: 3,
  ...o,
});

const T0 = Date.parse('2026-06-01T00:00:00Z');
const iso = (d: number) => new Date(T0 - d * 86_400_000).toISOString();

const entry = (s: ShowSummary, status: WatchStatus, o: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: s.id,
  show: s,
  status,
  watched: {},
  addedAt: iso(30),
  updatedAt: iso(10),
  ...o,
});

const taste = (o: Partial<TasteProfile> = {}): TasteProfile => ({
  genres: {},
  keywords: {},
  preferences: { languages: [], adventurousness: 0.3, obscurity: 0.3 },
  ...o,
});

const BB = show('cat:bb', 'Breaking Bad', { genres: ['crime', 'drama', 'thriller'], keywords: ['anti-hero', 'drugs', 'dark'], creators: ['Vince Gilligan'], networks: ['AMC'], rating: 9.5, year: 2008, seasonCount: 5 });
const FRIENDS = show('cat:friends', 'Friends', { genres: ['comedy', 'romance'], keywords: ['friendship', 'feel-good', 'workplace'], networks: ['NBC'], year: 1994, seasonCount: 10 });
const BCS = show('cat:bcs', 'Better Call Saul', { genres: ['crime', 'drama'], keywords: ['anti-hero', 'courtroom', 'slow burn'], creators: ['Vince Gilligan', 'Peter Gould'], networks: ['AMC'], rating: 9.0, year: 2015, seasonCount: 6 });
const OZARK = show('cat:ozark', 'Ozark', { genres: ['crime', 'drama', 'thriller'], keywords: ['anti-hero', 'drugs', 'family drama', 'dark'], networks: ['Netflix'], rating: 8.5, year: 2017, seasonCount: 4 });
const HIMYM = show('cat:himym', 'How I Met Your Mother', { genres: ['comedy', 'romance'], keywords: ['friendship', 'feel-good', 'romantic comedy'], networks: ['CBS'], rating: 8.3, year: 2005, seasonCount: 9 });
const BACHELOR = show('cat:bachelor', 'The Bachelor', { genres: ['reality', 'romance'], keywords: [], rating: 4.5, popularity: 60 });
const PLANET = show('cat:planet', 'Planet Earth', { genres: ['documentary'], keywords: ['nature' as string], rating: 9.4, popularity: 70, seasonCount: 1 });
const NARCOS = show('cat:narcos', 'Narcos', { genres: ['crime', 'drama', 'history'], keywords: ['drugs', 'based on true story', 'gangster'], networks: ['Netflix'], rating: 8.8, language: 'en' });
const DARK = show('cat:dark', 'Dark', { genres: ['scifi', 'mystery', 'drama'], keywords: ['time travel', 'mind-bending', 'small town', 'dark'], language: 'de', country: 'DE', rating: 8.7, popularity: 45 });

const base = (o: Partial<EngineInput> = {}): EngineInput => ({
  entries: {},
  blocked: {},
  feedback: {},
  taste: taste(),
  activity: [],
  candidates: [],
  now: T0,
  ...o,
});

const ids = (recs: { show: ShowSummary }[]) => recs.map((r) => r.show.title);

describe('recommend()', () => {
  const lib = {
    [BB.id]: entry(BB, 'completed', { rating: 10, favorite: true }),
    [FRIENDS.id]: entry(FRIENDS, 'dropped', { rating: 3 }),
  };
  const candidates = [BCS, OZARK, HIMYM, BACHELOR, PLANET, NARCOS, DARK];

  it('ranks shows like the loved seed first and explains why', () => {
    const out = recommend(base({ entries: lib, candidates }));
    const order = ids(out.ranked);
    expect(order[0]).toBe('Better Call Saul');
    expect(order.indexOf('Ozark')).toBeLessThan(order.indexOf('How I Met Your Mother'));
    const bcs = out.ranked[0];
    expect(bcs.reasons[0]).toMatchObject({ kind: 'because', ref: BB.id });
    expect(bcs.reasons[0].label).toBe('Because you loved Breaking Bad');
    expect(bcs.reasons.some((r) => r.label === 'From Vince Gilligan')).toBe(true);
    expect(bcs.match).toBeGreaterThan(80);
  });

  it('penalises shows resembling dropped / low-rated ones', () => {
    const out = recommend(base({ entries: lib, candidates }));
    const himym = out.ranked.find((r) => r.show.id === HIMYM.id)!;
    const narcos = out.ranked.find((r) => r.show.id === NARCOS.id)!;
    expect(himym.score).toBeLessThan(narcos.score);
    expect(himym.match).toBeLessThan(60);
  });

  it('never recommends library items, blocked shows or same-title duplicates', () => {
    const dupe = show('tvmaze:1', 'Breaking Bad', { year: 2008, genres: ['crime'] });
    const out = recommend(
      base({
        entries: lib,
        blocked: { [OZARK.id]: { id: OZARK.id, show: OZARK, at: iso(1), reason: 'not_interested' } },
        candidates: [...candidates, BB, dupe],
      }),
    );
    const t = ids(out.ranked);
    expect(t).not.toContain('Breaking Bad');
    expect(t).not.toContain('Friends');
    expect(t).not.toContain('Ozark');
  });

  it('keeps niche genres (reality/talk/…) down unless opted in', () => {
    const out = recommend(base({ entries: lib, candidates }));
    expect(ids(out.ranked).slice(-2)).toContain('The Bachelor');
    const optIn = recommend(base({ entries: lib, candidates, taste: taste({ genres: { reality: 1 } }) }));
    const a = out.ranked.find((r) => r.show.id === BACHELOR.id)!.score;
    const b = optIn.ranked.find((r) => r.show.id === BACHELOR.id)!.score;
    expect(b).toBeGreaterThan(a + 0.25);
  });

  it('respects avoided genres from the taste profile', () => {
    const out = recommend(base({ entries: lib, candidates, taste: taste({ genres: { crime: -1 } }) }));
    const top3 = ids(out.ranked.slice(0, 3));
    expect(top3).not.toContain('Ozark');
    expect(top3).not.toContain('Narcos');
  });

  it('respects language preferences', () => {
    const out = recommend(base({ entries: lib, candidates, taste: taste({ preferences: { languages: ['en'], adventurousness: 0.3, obscurity: 0.3 } }) }));
    const pref = recommend(base({ entries: lib, candidates }));
    const dark = (o: typeof out) => o.ranked.find((r) => r.show.id === DARK.id)!.score;
    expect(dark(out)).toBeLessThan(dark(pref) - 0.2);
  });

  it('uses co-occurrence lists to lift candidates the seed is linked to', () => {
    const plain = recommend(base({ entries: lib, candidates }));
    const linked = recommend(base({ entries: lib, candidates, related: [{ seed: BB.id, items: [DARK], strength: 1 }] }));
    const s = (o: typeof plain) => o.ranked.find((r) => r.show.id === DARK.id)!;
    expect(s(linked).score).toBeGreaterThan(s(plain).score + 0.1);
    expect(s(linked).seeds).toContain(BB.id);
  });

  it('diversifies the top picks (MMR) instead of returning clones', () => {
    const clones = Array.from({ length: 12 }, (_, i) =>
      show(`cat:clone${i}`, `Crime Clone ${i}`, { genres: ['crime', 'drama', 'thriller'], keywords: ['anti-hero', 'drugs', 'dark'], rating: 8.4 }),
    );
    const out = recommend(base({ entries: lib, candidates: [...clones, DARK, PLANET], limit: 6 }));
    const titles = ids(out.picks);
    expect(titles.length).toBe(6);
    expect(titles.some((t) => !t.startsWith('Crime Clone'))).toBe(true);
  });

  it('falls back to quality + popularity on cold start', () => {
    const out = recommend(base({ candidates }));
    expect(out.coldStart).toBe(true);
    expect(out.picks[0].show.rating).toBeGreaterThanOrEqual(8.5);
    expect(ids(out.ranked).at(-1)).toBe('The Bachelor');
    for (const r of out.ranked) {
      expect(r.match).toBeGreaterThanOrEqual(5);
      expect(r.match).toBeLessThanOrEqual(99);
    }
  });

  it('uses the explicit taste profile alone when there is no history', () => {
    const out = recommend(base({ candidates, taste: taste({ genres: { scifi: 1, mystery: 1 }, keywords: { 'time travel': 1 } }) }));
    expect(out.coldStart).toBe(false);
    expect(out.ranked[0].show.title).toBe('Dark');
  });

  it('builds shelves including a "Because you …" row', () => {
    const many = [...candidates, ...Array.from({ length: 10 }, (_, i) => show(`cat:x${i}`, `Crime Show ${i}`, { genres: ['crime', 'drama'], keywords: ['anti-hero', i % 2 ? 'drugs' : 'gangster'], rating: 7 + i / 10 }))];
    const out = recommend(base({ entries: lib, candidates: many }));
    const shelves = buildShelves(out);
    expect(shelves[0].id).toBe('picks');
    expect(shelves.some((s) => s.title === 'Because you loved Breaking Bad')).toBe(true);
  });

  it('exposes taste traits for the profile screen', () => {
    const out = recommend(base({ entries: lib, candidates }));
    const labels = out.traits.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['Crime', 'Anti-Hero']));
    expect(out.dislikes.map((t) => t.label)).toEqual(expect.arrayContaining(['Comedy']));
  });
});

describe('entryAffinity()', () => {
  const ctx = { now: T0 };
  it('orders explicit and implicit signals sensibly', () => {
    const loved = entryAffinity(entry(BB, 'completed', { rating: 10, favorite: true }), ctx);
    const finished = entryAffinity(entry(BB, 'completed'), ctx);
    const planned = entryAffinity(entry(BB, 'plan'), ctx);
    const dropped = entryAffinity(entry(BB, 'dropped'), ctx);
    const hated = entryAffinity(entry(BB, 'completed', { rating: 2 }), ctx);
    expect(loved).toBeGreaterThan(finished);
    expect(finished).toBeGreaterThan(planned);
    expect(planned).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(0);
    expect(hated).toBeLessThan(dropped);
  });

  it('rewards being deep into a show you are watching', () => {
    const early = entryAffinity(entry(BB, 'watching', { seasonSizes: [10, 10], watched: { 1: [1] } }), ctx);
    const deep = entryAffinity(entry(BB, 'watching', { seasonSizes: [10, 10], watched: { 1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2: [1, 2, 3, 4, 5, 6] } }), ctx);
    expect(deep).toBeGreaterThan(early + 0.2);
  });

  it('decays old positive signals', () => {
    const recent = entryAffinity(entry(BB, 'completed', { updatedAt: iso(5) }), ctx);
    const old = entryAffinity(entry(BB, 'completed', { updatedAt: iso(1500) }), ctx);
    expect(old).toBeLessThan(recent);
    expect(old).toBeGreaterThan(0);
  });
});
