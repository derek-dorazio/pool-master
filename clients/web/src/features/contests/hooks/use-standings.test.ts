import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useStandings } from './use-standings';

describe('useStandings', () => {
  it('returns standings entries for a contest', async () => {
    const { result } = renderHook(() => useStandings('contest-masters-2026'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const standings = result.current.data!;
    expect(Array.isArray(standings)).toBe(true);
    expect(standings.length).toBeGreaterThan(0);
  });

  it('returns entries with expected shape', async () => {
    const { result } = renderHook(() => useStandings('contest-masters-2026'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const entry = result.current.data![0];
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('rank');
    expect(entry).toHaveProperty('entryName');
    expect(entry).toHaveProperty('ownerName');
    expect(entry).toHaveProperty('totalScore');
    expect(entry).toHaveProperty('movement');
    expect(entry).toHaveProperty('isCurrentUser');
    expect(entry).toHaveProperty('isEliminated');
  });

  it('returns entries sorted by rank', async () => {
    const { result } = renderHook(() => useStandings('contest-masters-2026'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const standings = result.current.data!;
    for (let i = 1; i < standings.length; i++) {
      expect(standings[i].rank).toBeGreaterThanOrEqual(standings[i - 1].rank);
    }
  });

  it('does not fetch when contestId is undefined', () => {
    const { result } = renderHook(() => useStandings(undefined));

    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
