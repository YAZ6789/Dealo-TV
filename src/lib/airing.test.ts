import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildIcs,
  diffDays,
  episodeKey,
  episodeOverview,
  episodeTitle,
  episodeUid,
  epCode,
  groupByWeek,
  hasRealName,
  icsEscape,
  icsFold,
  localIso,
  pendingNotifications,
  relDays,
  rememberNotified,
  startOfWeek,
  summarizeEpisodes,
  weekDates,
  weekday,
} from './airing';

describe('dates', () => {
  it('adds days across month/year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('diffs days', () => {
    expect(diffDays('2026-10-07', '2026-10-19')).toBe(12);
    expect(diffDays('2026-10-07', '2026-10-01')).toBe(-6);
  });
  it('computes Monday-based weeks', () => {
    // 2026-10-07 is a Wednesday
    expect(weekday('2026-10-07')).toBe(2);
    expect(weekday('2026-10-11')).toBe(6);
    expect(startOfWeek('2026-10-07')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
    expect(weekDates('2026-10-07')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(weekDates('2026-10-07', 1)[0]).toBe('2026-10-12');
  });
  it('formats local dates', () => {
    expect(localIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
  it('labels relative days', () => {
    expect(relDays(0)).toBe('today');
    expect(relDays(1)).toBe('tomorrow');
    expect(relDays(-1)).toBe('yesterday');
    expect(relDays(12)).toBe('in 12 days');
    expect(relDays(14)).toBe('in 2 weeks');
    expect(relDays(15)).toBe('in 15 days');
    expect(relDays(-3)).toBe('3 days ago');
  });
});

describe('episodes', () => {
  it('codes and keys', () => {
    expect(epCode(2, 8)).toBe('S2·E8');
    expect(episodeKey('tvmaze:1', 2, 8)).toBe('tvmaze:1:2:8');
  });
  it('detects placeholder names', () => {
    expect(hasRealName('TBA')).toBe(false);
    expect(hasRealName('Episode 8')).toBe(false);
    expect(hasRealName('  ')).toBe(false);
    expect(hasRealName(undefined)).toBe(false);
    expect(hasRealName('Cold Harbor')).toBe(true);
    expect(hasRealName('Episode One Hundred')).toBe(true);
  });
  it('hides names and synopses of unwatched episodes in spoiler-free mode', () => {
    const ep = { season: 2, number: 8, name: 'Sweet Vitriol', overview: '<p>Something <b>happens</b>.</p>' };
    expect(episodeTitle(ep, { spoilerFree: false, watched: false })).toBe('Sweet Vitriol');
    expect(episodeTitle(ep, { spoilerFree: true, watched: false })).toBe('Episode 8');
    expect(episodeTitle(ep, { spoilerFree: true, watched: true })).toBe('Sweet Vitriol');
    expect(episodeTitle({ season: 1, number: 3, name: 'TBA' }, { spoilerFree: false, watched: false })).toBe('Episode 3');
    expect(episodeOverview(ep, { spoilerFree: false, watched: false })).toBe('Something happens.');
    expect(episodeOverview(ep, { spoilerFree: true, watched: false })).toBeUndefined();
  });
  it('summarizes for the banner', () => {
    const items = [
      { title: 'Severance', season: 2, number: 8 },
      { title: 'The Bear', season: 3, number: 4 },
      { title: 'Andor', season: 2, number: 1 },
      { title: 'Slow Horses', season: 4, number: 2 },
    ];
    expect(summarizeEpisodes(items.slice(0, 2))).toBe('Severance S2·E8, The Bear S3·E4');
    expect(summarizeEpisodes(items, 2)).toBe('Severance S2·E8, The Bear S3·E4 +2 more');
  });
});

describe('groupByWeek', () => {
  it('groups by Monday and sorts', () => {
    const g = groupByWeek([{ airDate: '2026-10-20' }, { airDate: '2026-10-13' }, { airDate: '2026-10-18' }, { airDate: '2026-10-19' }]);
    expect(g.map((w) => [w.start, w.items.map((i) => i.airDate)])).toEqual([
      ['2026-10-12', ['2026-10-13', '2026-10-18']],
      ['2026-10-19', ['2026-10-19', '2026-10-20']],
    ]);
  });
});

describe('notification bookkeeping', () => {
  it('returns only keys not yet notified', () => {
    expect(pendingNotifications(['a', 'b', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
  it('remembers newest keys with a cap', () => {
    expect(rememberNotified(['a', 'b'], ['c', 'a'], 3)).toEqual(['b', 'c', 'a']);
    expect(rememberNotified(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd']);
  });
});

describe('ics', () => {
  it('escapes text values', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(icsEscape('x\r\ny')).toBe('x\\ny');
  });
  it('folds long lines at 75 octets without splitting characters', () => {
    const long = 'SUMMARY:' + 'é'.repeat(60);
    const folded = icsFold(long);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(long);
    expect(icsFold('SHORT:x')).toBe('SHORT:x');
  });
  it('builds a valid calendar of all-day events', () => {
    const ics = buildIcs(
      [
        { uid: episodeUid('tvmaze:44933', 2, 8), date: '2026-10-09', summary: 'Severance S2·E8, "Sweet; Vitriol"', description: 'Line 1\nLine 2', url: 'https://example.com/#/show/x' },
        { uid: episodeUid('tmdb:1', 1, 1), date: '2026-12-31', summary: 'New Year' },
      ],
      { name: 'Dealo — Airing', now: new Date('2026-10-07T10:20:30.456Z') },
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain('X-WR-CALNAME:Dealo — Airing');
    expect(ics).toContain('UID:tvmaze-44933-s2e8@dealo.tv');
    expect(ics).toContain('DTSTAMP:20261007T102030Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261010');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(ics).toContain('SUMMARY:Severance S2·E8\\, "Sweet\\; Vitriol"');
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
  });
});
