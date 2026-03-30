import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useMyLeagues } from './use-my-leagues';

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
