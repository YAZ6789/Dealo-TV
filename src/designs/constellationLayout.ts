import type { GenreKey, LibraryEntry, Recommendation, ShowSummary } from '../types';

/**
 * Lays out "your universe": you at the centre, every show placed in a genre
 * sector. Library shows orbit close (the more you loved it, the closer);
 * recommendations float in the outer discovery field (the better the match,
 * the closer). Deterministic: the same data always draws the same sky.
 */

export interface StarNode {
  id: string;
  show: ShowSummary;
  kind: 'library' | 'rec';
  entry?: LibraryEntry;
  rec?: Recommendation;
  x: number;
  y: number;
  r: number;
  sector: number;
}

export interface Sector {
  key: GenreKey | 'other';
  start: number;
  end: number;
  mid: number;
}

export interface Link {
  from: string;
  to: string;
}

export interface Sky {
  nodes: StarNode[];
  sectors: Sector[];
  links: Link[];
  /** Radius (0–1 of R) separating library from discovery field. */
  split: number;
}

export const R = 1000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const unit = (s: string, salt: number) => (hash(s + salt) % 10000) / 10000;

const affinity = (e: LibraryEntry) => {
  if (e.rating != null) return Math.max(0, Math.min(1, (e.rating - 1) / 9));
  return { completed: 0.62, watching: 0.7, on_hold: 0.4, plan: 0.35, dropped: 0.1 }[e.status] + (e.favorite ? 0.3 : 0);
};

export function layoutSky(entries: LibraryEntry[], recs: Recommendation[], maxSectors = 8): Sky {
  const split = 0.5;
  // Sector genres: the most common primary genres across everything shown.
  const counts = new Map<GenreKey, number>();
  const all = [...entries.map((e) => e.show), ...recs.map((r) => r.show)];
  for (const s of all) if (s.genres[0]) counts.set(s.genres[0], (counts.get(s.genres[0]) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSectors)
    .map(([g]) => g);
  const keys: Sector['key'][] = top.length < counts.size ? [...top, 'other'] : top.length ? top : ['other'];
  // Sector width ∝ how many shows live there (with a floor so small genres stay readable).
  const sectorCount = (k: Sector['key']) =>
    k === 'other' ? all.filter((x) => !x.genres[0] || !top.includes(x.genres[0])).length : (counts.get(k) ?? 0);
  const raw = keys.map((k) => Math.max(sectorCount(k), all.length * 0.05, 1));
  const total = raw.reduce((a, b) => a + b, 0);
  let acc = -Math.PI / 2;
  const sectors: Sector[] = keys.map((key, i) => {
    const w = (raw[i] / total) * Math.PI * 2;
    const sec = { key, start: acc, end: acc + w, mid: acc + w / 2 };
    acc += w;
    return sec;
  });
  const sectorOf = (s: ShowSummary) => {
    for (const g of s.genres) {
      const i = keys.indexOf(g);
      if (i >= 0) return i;
    }
    return keys.length - 1;
  };

  const nodes: StarNode[] = [];
  const place = (id: string, show: ShowSummary, dist: number, size: number, extra: Partial<StarNode>) => {
    const si = sectorOf(show);
    const sec = sectors[si];
    const a = sec.start + (sec.end - sec.start) * (0.1 + 0.8 * unit(id, 1));
    const d = Math.max(0.12, Math.min(0.98, dist + (unit(id, 2) - 0.5) * 0.05)) * R;
    nodes.push({ id, show, x: Math.cos(a) * d, y: Math.sin(a) * d, r: size, sector: si, kind: 'library', ...extra });
  };

  for (const e of entries) {
    const aff = affinity(e);
    place(e.id, e.show, 0.15 + (1 - Math.min(1, aff)) * (split - 0.2), 11 + aff * 12, { kind: 'library', entry: e });
  }
  // Match scores bunch up (most good recs are 80–98%), so distance uses rank
  // blended with the score: the best match is nearest, the long tail at the rim.
  const ranked = [...recs].sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => {
    const t = ranked.length > 1 ? i / (ranked.length - 1) : 0;
    const blend = 0.75 * t + 0.25 * (1 - r.match / 100);
    place(r.show.id, r.show, split + 0.07 + blend * (0.95 - split - 0.07), 9 + (r.match / 100) * 10, { kind: 'rec', rec: r });
  });

  relax(nodes, sectors);

  const ids = new Set(nodes.map((n) => n.id));
  const links: Link[] = [];
  for (const r of recs) {
    const ref = r.reasons.find((x) => x.kind === 'because')?.ref;
    if (ref && ids.has(ref)) links.push({ from: ref, to: r.show.id });
  }
  return { nodes, sectors, links, split };
}

/** Push overlapping stars apart while keeping each roughly in its sector and ring. */
function relax(nodes: StarNode[], sectors: Sector[]) {
  const pad = 8;
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r + pad;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const ux = dx / d || 1;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    // keep inside the sector wedge and the disc
    for (const n of nodes) {
      const sec = sectors[n.sector];
      let ang = Math.atan2(n.y, n.x);
      let dist = Math.hypot(n.x, n.y);
      // normalise angle into the sector's range
      while (ang < sec.start) ang += Math.PI * 2;
      while (ang > sec.start + Math.PI * 2) ang -= Math.PI * 2;
      const width = sec.end - sec.start;
      const lo = sec.start + width * 0.04;
      const hi = sec.end - width * 0.04;
      if (ang < lo || ang > hi) ang = ang - sec.start > Math.PI ? lo : Math.min(hi, Math.max(lo, ang));
      dist = Math.max(0.1 * R, Math.min(0.99 * R, dist));
      n.x = Math.cos(ang) * dist;
      n.y = Math.sin(ang) * dist;
    }
    if (!moved) break;
  }
}
