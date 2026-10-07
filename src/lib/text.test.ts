import { describe, expect, it } from 'vitest';
import { diceCoefficient, normalizeTitle, slugify, stripTitleQualifier, titleQualifier, titleSimilarity } from './text';

describe('normalizeTitle', () => {
  it.each([
    ['The Office', 'office'],
    ['  Breaking   Bad ', 'breaking bad'],
    ['Pokémon', 'pokemon'],
    ['Law & Order', 'law and order'],
    ["Grey's Anatomy", 'greys anatomy'],
    ['Mr. Robot', 'mr robot'],
    ['Dark (2017)', 'dark'],
    ['A Very English Scandal', 'very english scandal'],
    ['An Idiot Abroad', 'idiot abroad'],
    ['The', 'the'],
    ['Avatar: The Last Airbender', 'avatar the last airbender'],
    ['Shōgun', 'shogun'],
    ['3 Body Problem', '3 body problem'],
    ['', ''],
  ])('%s → %s', (input, out) => {
    expect(normalizeTitle(input)).toBe(out);
  });
});

describe('qualifiers', () => {
  it('strips and reads trailing country/year qualifiers', () => {
    expect(stripTitleQualifier('The Office (US)')).toBe('The Office');
    expect(stripTitleQualifier('The Office (U.K.)')).toBe('The Office');
    expect(stripTitleQualifier('Doctor Who (2005)')).toBe('Doctor Who');
    expect(stripTitleQualifier('Breaking Bad')).toBe('Breaking Bad');
    expect(stripTitleQualifier('Love, Death & Robots (Volume Two)')).toBe('Love, Death & Robots (Volume Two)');
    expect(titleQualifier('The Office (US)')).toBe('US');
    expect(titleQualifier('The Office (U.K.)')).toBe('UK');
    expect(titleQualifier('Breaking Bad')).toBeUndefined();
  });
});

describe('titleSimilarity', () => {
  it('is 1 for normalized-equal titles', () => {
    expect(titleSimilarity('The Office', 'office')).toBe(1);
    expect(titleSimilarity('Law & Order', 'Law and Order')).toBe(1);
    expect(titleSimilarity('Pokémon', 'POKEMON')).toBe(1);
  });
  it('scores qualifier-only differences high', () => {
    expect(titleSimilarity('The Office (US)', 'The Office')).toBeGreaterThanOrEqual(0.95);
    expect(titleSimilarity('Shameless', 'Shameless (UK)')).toBeGreaterThanOrEqual(0.95);
  });
  it('is symmetric-ish and ranks closer titles higher', () => {
    const a = titleSimilarity('Breaking Bad', 'Breaking Bad: Original Minisodes');
    const b = titleSimilarity('Breaking Bad', 'Bad Sisters');
    expect(a).toBeGreaterThan(b);
    expect(titleSimilarity('Stranger Things', 'Strnager Things')).toBeGreaterThan(0.7);
    expect(titleSimilarity('Spider Man', 'Spiderman')).toBeGreaterThan(0.95);
    expect(titleSimilarity('Lost', 'Succession')).toBeLessThan(0.2);
  });
  it('handles empties', () => {
    expect(titleSimilarity('', 'Lost')).toBe(0);
    expect(diceCoefficient('a', 'b')).toBe(0);
    expect(diceCoefficient('ab', 'ab')).toBe(1);
  });
});

describe('slugify', () => {
  it.each([
    ["Grey's Anatomy & Co.", 'greys-anatomy-and-co'],
    ['  Pokémon: Indigo League ', 'pokemon-indigo-league'],
    ['---', ''],
    ['9-1-1', '9-1-1'],
  ])('%s → %s', (input, out) => expect(slugify(input)).toBe(out));
});
