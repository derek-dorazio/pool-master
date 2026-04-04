import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useMyLeagues } from './use-my-leagues';
import { vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  client: {},
  listLeagues: vi.fn().mockResolvedValue({
    data: {
      leagues: [
        { id: 'league-1', name: 'Weekend Warriors', memberCount: 12, activeContestCount: 1, role: 'Commissioner' },
        { id: 'league-2', name: 'Soccer Fanatics', memberCount: 8, activeContestCount: 1, role: 'Member' },
      ],
    },
    error: null,
  }),
}));

describe('useMyLeagues', () => {
  it('returns leagues array', async () => {
    const { result } = renderHook(() => useMyLeagues());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const leagues = result.current.data!;
    expect(Array.isArray(leagues)).toBe(true);
    expect(leagues.length).toBeGreaterThan(0);
  });

  it('returns leagues with expected shape', async () => {
    const { result } = renderHook(() => useMyLeagues());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const league = result.current.data![0];
    expect(league).toHaveProperty('id');
    expect(league).toHaveProperty('name');
    expect(league).toHaveProperty('memberCount');
    expect(league).toHaveProperty('activeContestCount');
    expect(league).toHaveProperty('role');
  });
});
