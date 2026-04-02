import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { useStandings } from './use-standings';

describe('useStandings', () => {
  it('returns standings response from API', async () => {
    const { result } = renderHook(() => useStandings('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    // MSW returns { standings: [], total: 0, contestId: 'contest-1' }
    expect(data).toHaveProperty('standings');
    expect(data).toHaveProperty('total', 0);
    expect(data).toHaveProperty('contestId', 'contest-1');
    expect(Array.isArray(data.standings)).toBe(true);
  });

  it('returns entries with expected shape when server provides data', async () => {
    server.use(
      http.get('/api/v1/contests/:id/standings', () => {
        return HttpResponse.json({
          standings: [
            { id: 'e1', rank: 1, entryName: 'Eagle Eye', ownerName: 'Sarah K.', totalScore: 298, movement: 'none', isCurrentUser: false, isEliminated: false },
            { id: 'e2', rank: 2, entryName: 'Birdie Brigade', ownerName: 'Jake M.', totalScore: 285, movement: 'up', isCurrentUser: false, isEliminated: false },
            { id: 'e3', rank: 3, entryName: 'My Entry', ownerName: 'You', totalScore: 274, movement: 'up', isCurrentUser: true, isEliminated: false },
          ],
          total: 3,
          contestId: 'contest-1',
        });
      }),
    );

    const { result } = renderHook(() => useStandings('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings.length).toBe(3);

    const entry = standings[0];
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
    server.use(
      http.get('/api/v1/contests/:id/standings', () => {
        return HttpResponse.json({
          standings: [
            { id: 'e1', rank: 1, entryName: 'Eagle Eye', ownerName: 'Sarah K.', totalScore: 298, movement: 'none', isCurrentUser: false, isEliminated: false },
            { id: 'e2', rank: 2, entryName: 'Birdie Brigade', ownerName: 'Jake M.', totalScore: 285, movement: 'up', isCurrentUser: false, isEliminated: false },
            { id: 'e3', rank: 3, entryName: 'My Entry', ownerName: 'You', totalScore: 274, movement: 'up', isCurrentUser: true, isEliminated: false },
          ],
          total: 3,
          contestId: 'contest-1',
        });
      }),
    );

    const { result } = renderHook(() => useStandings('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    const standings = data.standings as Array<Record<string, number>>;
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
