import { describe, it, expect } from 'vitest';
import { CATALOG } from './catalog';
import { GENRES } from '../types';
import { THEME_TAGS } from '../lib/genres';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const genreSet = new Set<string>(GENRES);
const tagSet = new Set<string>(THEME_TAGS);

describe('built-in catalog', () => {
  it('has at least 200 shows', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(200);
  });

  it('has unique kebab-case slugs', () => {
    const seen = new Set<string>();
    for (const s of CATALOG) {
      expect(s.slug, s.slug).toMatch(KEBAB);
      expect(seen.has(s.slug), `duplicate slug ${s.slug}`).toBe(false);
      seen.add(s.slug);
    }
  });

  it('has unique titles', () => {
    const seen = new Set<string>();
    for (const s of CATALOG) {
      const key = s.title.toLowerCase();
      expect(seen.has(key), `duplicate title ${s.title}`).toBe(false);
      seen.add(key);
    }
  });

  it('uses 1–4 known genres per show, without duplicates', () => {
    for (const s of CATALOG) {
      expect(s.genres.length, s.slug).toBeGreaterThanOrEqual(1);
      expect(s.genres.length, s.slug).toBeLessThanOrEqual(4);
      expect(new Set(s.genres).size, s.slug).toBe(s.genres.length);
      for (const g of s.genres) expect(genreSet.has(g), `${s.slug}: ${g}`).toBe(true);
    }
  });

  it('uses 3–7 known theme tags per show, without duplicates', () => {
    for (const s of CATALOG) {
      expect(s.tags.length, s.slug).toBeGreaterThanOrEqual(3);
      expect(s.tags.length, s.slug).toBeLessThanOrEqual(7);
      expect(new Set(s.tags).size, s.slug).toBe(s.tags.length);
      for (const t of s.tags) expect(tagSet.has(t), `${s.slug}: ${t}`).toBe(true);
    }
  });

  it('has non-empty seasons with positive integer episode counts', () => {
    for (const s of CATALOG) {
      expect(s.seasons.length, s.slug).toBeGreaterThan(0);
      for (const n of s.seasons) {
        expect(Number.isInteger(n) && n > 0, `${s.slug}: ${n}`).toBe(true);
      }
    }
  });

  it('has plausible years and consistent air status', () => {
    for (const s of CATALOG) {
      expect(Number.isInteger(s.year), s.slug).toBe(true);
      expect(s.year, s.slug).toBeGreaterThanOrEqual(1950);
      expect(s.year, s.slug).toBeLessThanOrEqual(2026);
      if (s.endYear !== undefined) {
        expect(s.airStatus, `${s.slug}: endYear only when ended`).toBe('ended');
        expect(s.endYear, s.slug).toBeGreaterThanOrEqual(s.year);
        expect(s.endYear, s.slug).toBeLessThanOrEqual(2026);
      }
      if (s.airStatus === 'ended') expect(s.endYear, `${s.slug}: ended needs endYear`).toBeDefined();
    }
  });

  it('has ratings, votes, popularity and runtime in range', () => {
    for (const s of CATALOG) {
      expect(s.rating, s.slug).toBeGreaterThanOrEqual(0);
      expect(s.rating, s.slug).toBeLessThanOrEqual(10);
      expect(Math.round(s.rating * 10), s.slug).toBe(s.rating * 10);
      expect(s.votes, s.slug).toBeGreaterThan(0);
      expect(s.popularity, s.slug).toBeGreaterThanOrEqual(1);
      expect(s.popularity, s.slug).toBeLessThanOrEqual(100);
      expect(s.runtime, s.slug).toBeGreaterThan(0);
    }
  });

  it('has short, non-empty overviews and credits', () => {
    for (const s of CATALOG) {
      expect(s.overview.length, s.slug).toBeGreaterThan(0);
      expect(s.overview.length, `${s.slug} overview is ${s.overview.length} chars`).toBeLessThanOrEqual(220);
      expect(s.creators.length, s.slug).toBeGreaterThanOrEqual(1);
      expect(s.cast.length, s.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it('has valid country and language codes', () => {
    for (const s of CATALOG) {
      expect(s.country, s.slug).toMatch(/^[A-Z]{2}$/);
      expect(s.language, s.slug).toMatch(/^[a-z]{2}$/);
      if (s.originalTitle !== undefined) expect(s.originalTitle, s.slug).not.toBe(s.title);
    }
  });

  it('is diverse: enough anime and Korean-language shows', () => {
    expect(CATALOG.filter((s) => s.genres.includes('anime')).length).toBeGreaterThanOrEqual(15);
    expect(CATALOG.filter((s) => s.language === 'ko').length).toBeGreaterThanOrEqual(10);
  });
});
