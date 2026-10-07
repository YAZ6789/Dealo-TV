import { describe, expect, it } from 'vitest';
import type { ShowDetail } from '../types';
import { airedSeasonSizes, hasAired } from './index';

const base: ShowDetail = { id: 'tvmaze:1', source: 'tvmaze', title: 'X', genres: [], seasons: [] };
const ep = (season: number, number: number, airDate?: string) => ({ season, number, airDate });

describe('airedSeasonSizes', () => {
  it('indexes by season number and zero-fills gaps', () => {
    const d: ShowDetail = {
      ...base,
      airStatus: 'ended',
      seasons: [
        { number: 1, episodeCount: 2, episodes: [ep(1, 1, '2020-01-01'), ep(1, 2, '2020-01-08')] },
        { number: 3, episodeCount: 1, episodes: [ep(3, 1, '2022-01-01')] },
      ],
    };
    expect(airedSeasonSizes(d)).toEqual([2, 0, 1]);
  });

  it('does not count undated or future episodes of a running show as aired', () => {
    const d: ShowDetail = {
      ...base,
      airStatus: 'ongoing',
      seasons: [{ number: 1, episodeCount: 3, episodes: [ep(1, 1, '2020-01-01'), ep(1, 2, '2999-01-01'), ep(1, 3)] }],
    };
    expect(airedSeasonSizes(d)).toEqual([1]);
    expect(hasAired({}, { airStatus: 'ended' })).toBe(true);
    expect(hasAired({}, { airStatus: 'ongoing', synthetic: true })).toBe(true);
  });
});
