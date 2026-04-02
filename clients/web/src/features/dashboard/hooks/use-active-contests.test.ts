import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useActiveContests } from './use-active-contests';
import { vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        id: 'contest-1',
        name: 'NFL Survivor Pool',
        sport: 'football',
        leagueName: 'Weekend Warriors',
        rank: 3,
        totalEntrants: 12,
        score: 47,
        delta: 5,
      },
      {
        id: 'contest-2',
        name: 'Premier League Picks',
        sport: 'soccer',
        leagueName: 'Soccer Fanatics',
        rank: 1,
        totalEntrants: 8,
        score: 82,
        delta: 0,
      },
    ]),
  },
}));

describe('useActiveContests', () => {
  it('returns data with contests array', async () => {
    const { result } = renderHook(() => useActiveContests());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contests = result.current.data!;
    expect(Array.isArray(contests)).toBe(true);
    expect(contests.length).toBeGreaterThan(0);
  });

  it('returns contests with expected shape', async () => {
    const { result } = renderHook(() => useActiveContests());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contest = result.current.data![0];
    expect(contest).toHaveProperty('id');
    expect(contest).toHaveProperty('name');
    expect(contest).toHaveProperty('sport');
    expect(contest).toHaveProperty('leagueName');
    expect(contest).toHaveProperty('rank');
    expect(contest).toHaveProperty('totalEntrants');
    expect(contest).toHaveProperty('score');
    expect(contest).toHaveProperty('delta');
  });
});
