import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useContest } from './use-contest';

describe('useContest', () => {
  it('returns contest data for a given id', async () => {
    const { result } = renderHook(() => useContest('contest-masters-2026'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contest = result.current.data!;
    expect(contest).toHaveProperty('id');
    expect(contest).toHaveProperty('name');
    expect(contest).toHaveProperty('sport');
    expect(contest).toHaveProperty('status');
    expect(contest).toHaveProperty('leagueName');
    expect(contest).toHaveProperty('contestType');
    expect(contest).toHaveProperty('totalEntries');
  });

  it('returns contest with myEntry and topEntries', async () => {
    const { result } = renderHook(() => useContest('contest-masters-2026'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contest = result.current.data!;
    expect(contest.myEntry).toBeDefined();
    expect(contest.myEntry).toHaveProperty('rank');
    expect(contest.myEntry).toHaveProperty('score');
    expect(Array.isArray(contest.topEntries)).toBe(true);
    expect(contest.topEntries.length).toBeGreaterThan(0);
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => useContest(undefined));

    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
