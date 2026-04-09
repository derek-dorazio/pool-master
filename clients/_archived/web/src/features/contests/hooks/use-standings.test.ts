import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { useStandings } from './use-standings';

describe('useStandings', () => {
  it('returns standings response from API', async () => {
    const { result } = renderHook(() => useStandings('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toHaveProperty('standings');
    expect(data).toHaveProperty('total', 2);
    expect(data).toHaveProperty('contestId', 'contest-1');
    expect(Array.isArray(data.standings)).toBe(true);
  });

  it('returns entries with expected shape when server provides data', async () => {
    server.use(
      http.get('/api/v1/contests/:id/standings', () => {
        const now = new Date().toISOString();
        return HttpResponse.json({
          standings: [
            { rank: 1, entryId: 'e1', entryName: 'Eagle Eye', ownerDisplayName: 'Sarah K.', ownerId: 'u1', totalScore: 298, previousRank: 2, movement: 'up', isEliminated: false, lastUpdatedAt: now },
            { rank: 2, entryId: 'e2', entryName: 'Birdie Brigade', ownerDisplayName: 'Jake M.', ownerId: 'u2', totalScore: 285, previousRank: 1, movement: 'down', isEliminated: false, lastUpdatedAt: now },
            { rank: 3, entryId: 'e3', entryName: 'My Entry', ownerDisplayName: 'You', ownerId: 'u3', totalScore: 274, previousRank: 3, movement: 'same', isEliminated: false, lastUpdatedAt: now },
          ],
          total: 3,
          page: 1,
          pageSize: 25,
          contestId: 'contest-1',
        });
      }),
    );

    const { result } = renderHook(() => useStandings('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const standings = result.current.data!.standings;
    expect(standings.length).toBe(3);

    const entry = standings[0];
    expect(entry).toHaveProperty('entryId');
    expect(entry).toHaveProperty('rank');
    expect(entry).toHaveProperty('entryName');
    expect(entry).toHaveProperty('ownerDisplayName');
    expect(entry).toHaveProperty('ownerId');
    expect(entry).toHaveProperty('totalScore');
    expect(entry).toHaveProperty('movement');
    expect(entry).toHaveProperty('previousRank');
    expect(entry).toHaveProperty('isEliminated');
    expect(entry).toHaveProperty('lastUpdatedAt');
  });

  it('returns entries sorted by rank', async () => {
    server.use(
      http.get('/api/v1/contests/:id/standings', () => {
        const now = new Date().toISOString();
        return HttpResponse.json({
          standings: [
            { rank: 1, entryId: 'e1', entryName: 'Eagle Eye', ownerDisplayName: 'Sarah K.', ownerId: 'u1', totalScore: 298, previousRank: 2, movement: 'up', isEliminated: false, lastUpdatedAt: now },
            { rank: 2, entryId: 'e2', entryName: 'Birdie Brigade', ownerDisplayName: 'Jake M.', ownerId: 'u2', totalScore: 285, previousRank: 1, movement: 'down', isEliminated: false, lastUpdatedAt: now },
            { rank: 3, entryId: 'e3', entryName: 'My Entry', ownerDisplayName: 'You', ownerId: 'u3', totalScore: 274, previousRank: 3, movement: 'same', isEliminated: false, lastUpdatedAt: now },
          ],
          total: 3,
          page: 1,
          pageSize: 25,
          contestId: 'contest-1',
        });
      }),
    );

    const { result } = renderHook(() => useStandings('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const standings = result.current.data!.standings;
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
