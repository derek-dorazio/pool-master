import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useActiveContests } from './use-active-contests';

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
