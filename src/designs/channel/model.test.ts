import { describe, expect, it } from 'vitest';
import { buildChannels, neighbours, resolveTuned, stepChannel } from './model';
import type { Collection } from '../useCollections';
import type { ShowSummary } from '../../types';

const s = (id: string) => ({ id, title: id, genres: [] }) as unknown as ShowSummary;
const cols = (watched: string[], watching: string[], foryou: string[]): Collection[] => [
  { id: 'watched', label: 'Watched', items: watched.map((id) => ({ show: s(id) })) },
  { id: 'continue', label: 'Watching', items: watching.map((id) => ({ show: s(id) })) },
  { id: 'foryou', label: 'For you', items: foryou.map((id) => ({ show: s(id) })) },
];

describe('channel model', () => {
  const chans = buildChannels(cols(['a', 'b'], ['c'], ['r1', 'r2']));
  it('numbers channels across networks', () => {
    expect(chans.map((c) => `${c.no}${c.cid[0]}`)).toEqual(['1w', '2w', '3c', '4f', '5f']);
  });
  it('defaults to the fallback network', () => {
    expect(resolveTuned(chans, { idx: 0 }, 'watched').current?.item.show.id).toBe('a');
  });
  it('follows a library show that moved lists', () => {
    const after = buildChannels(cols(['a', 'b'], ['c', 'x'], []));
    const r = resolveTuned(after, { cid: 'watched', showId: 'x', idx: 1 }, 'watched');
    // x was never in watched → follows it to Watching
    expect(r.cid).toBe('continue');
    expect(r.current?.item.show.id).toBe('x');
  });
  it('keeps the slot when a recommendation leaves the list', () => {
    const r = resolveTuned(chans, { cid: 'foryou', showId: 'gone', idx: 5 }, 'watched');
    expect(r.current?.item.show.id).toBe('r2');
  });
  it('empty network has no current', () => {
    expect(resolveTuned([], { idx: 0 }, 'foryou')).toEqual({ cid: 'foryou' });
  });
  it('steps and wraps; tiny dials work', () => {
    expect(stepChannel(chans, chans[4], 1)?.no).toBe(1);
    expect(stepChannel(chans, chans[0], -1)?.no).toBe(5);
    const one = buildChannels(cols(['a'], [], []));
    expect(stepChannel(one, one[0], 1)?.no).toBe(1);
    expect(stepChannel([], undefined, 1)).toBeUndefined();
  });
  it('lists neighbours nearest first without duplicates', () => {
    expect(neighbours(chans, chans[0], 3).map((c) => c.no)).toEqual([2, 5, 3, 4]);
    expect(neighbours(chans.slice(0, 1), chans[0])).toEqual([]);
  });
});
