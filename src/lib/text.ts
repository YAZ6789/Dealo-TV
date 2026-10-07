/**
 * Small, dependency-free text helpers used for fuzzy title matching
 * (spreadsheet import ↔ provider search results) and for slugs.
 */

/** Strip combining diacritical marks ("Pokémon" → "Pokemon"). */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const TRAILING_YEAR = /\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/;
/**
 * A trailing qualifier that disambiguates otherwise identical titles:
 * a country code "(US)", "(U.K.)", or a year "(2005)".
 */
const TRAILING_QUALIFIER = /\s*[([]\s*(?:[A-Za-z]{2,3}|[A-Za-z](?:\.[A-Za-z]){1,2}\.?|(?:19|20)\d{2})\s*[)\]]\s*$/;

/**
 * Canonical form of a show title for comparisons:
 * lower-case, no diacritics, `&` → "and", no punctuation/apostrophes,
 * single spaces, no leading article ("the"/"a"/"an"), no trailing "(2019)".
 */
export function normalizeTitle(s: string): string {
  let t = stripDiacritics(String(s ?? '')).toLowerCase().trim();
  t = t.replace(TRAILING_YEAR, '');
  t = t.replace(/&/g, ' and ');
  t = t.replace(/['’‘`´ʼ]/g, '');
  t = t.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:the|a|an) (?=\S)/, '');
  return t;
}

/**
 * Remove a trailing disambiguation qualifier such as "(US)", "(UK)" or "(2005)".
 * Returns the input unchanged when there is none.
 */
export function stripTitleQualifier(s: string): string {
  const out = s.replace(TRAILING_QUALIFIER, '').trim();
  return out || s.trim();
}

/** The qualifier text itself, upper-cased without dots ("(U.S.)" → "US"), if any. */
export function titleQualifier(s: string): string | undefined {
  const m = s.match(/[([]\s*([^()[\]]+?)\s*[)\]]\s*$/);
  if (!m || !TRAILING_QUALIFIER.test(s)) return undefined;
  return m[1].replace(/\./g, '').toUpperCase();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient over character bigrams of two (already normalized) strings. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [g, n] of ga) {
    const m = gb.get(g);
    if (m) inter += Math.min(n, m);
  }
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/**
 * Title similarity in [0, 1].
 *  - identical after {@link normalizeTitle} → 1
 *  - identical once a trailing country/year qualifier is removed from either
 *    side ("The Office (US)" vs "The Office") → 0.95
 *  - otherwise Sørensen–Dice on character bigrams of the normalized titles.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const qa = normalizeTitle(stripTitleQualifier(a));
  const qb = normalizeTitle(stripTitleQualifier(b));
  if (qa && qb && qa === qb) return 0.95;
  // Compare without spaces too, so "Spider Man" ≈ "Spiderman".
  const plain = diceCoefficient(na, nb);
  const squashed = diceCoefficient(na.replace(/ /g, ''), nb.replace(/ /g, ''));
  return Math.min(0.99, Math.max(plain, squashed));
}

/** URL/file-safe slug: "Grey's Anatomy & Co." → "greys-anatomy-and-co". */
export function slugify(s: string): string {
  return stripDiacritics(String(s ?? ''))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
