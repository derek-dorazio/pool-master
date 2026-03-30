import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useTrendingLeagues, usePopularContests } from './use-discovery';

describe('useTrendingLeagues', () => {
  it('returns leagues array', async () => {
    const { result } = renderHook(() => useTrendingLeagues());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const leagues = result.current.data!;
    expect(Array.isArray(leagues)).toBe(true);
    expect(leagues.length).toBeGreaterThan(0);
  });

  it('returns leagues with expected shape', async () => {
    const { result } = renderHook(() => useTrendingLeagues());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const league = result.current.data![0];
    expect(league).toHaveProperty('id');
    expect(league).toHaveProperty('name');
    expect(league).toHaveProperty('sport');
    expect(league).toHaveProperty('memberCount');
    expect(league).toHaveProperty('maxMembers');
    expect(league).toHaveProperty('activeContestCount');
    expect(league).toHaveProperty('joinPolicy');
    expect(league).toHaveProperty('commissionerName');
  });

  it('filters by sport when provided', async () => {
    const { result } = renderHook(() => useTrendingLeagues('GOLF'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const leagues = result.current.data!;
    leagues.forEach((league) => {
      expect(league.sport).toBe('GOLF');
    });
  });
});

describe('usePopularContests', () => {
  it('returns contests array', async () => {
    const { result } = renderHook(() => usePopularContests());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contests = result.current.data!;
    expect(Array.isArray(contests)).toBe(true);
    expect(contests.length).toBeGreaterThan(0);
  });

  it('returns contests with expected shape', async () => {
    const { result } = renderHook(() => usePopularContests());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contest = result.current.data![0];
    expect(contest).toHaveProperty('id');
    expect(contest).toHaveProperty('leagueName');
    expect(contest).toHaveProperty('contestName');
    expect(contest).toHaveProperty('sport');
    expect(contest).toHaveProperty('memberCount');
    expect(contest).toHaveProperty('status');
  });
});
