import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useShareCard } from './use-share';

describe('useShareCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns share card data', async () => {
    const { result } = renderHook(() => useShareCard('share-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveProperty('id');
    expect(result.current.data).toHaveProperty('type');
    expect(result.current.data).toHaveProperty('title');
  });

  it('returns data with expected shape', async () => {
    const { result } = renderHook(() => useShareCard('share-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const data = result.current.data!;
    expect(data).toHaveProperty('sport');
    expect(data).toHaveProperty('winnerName');
    expect(data).toHaveProperty('winnerScore');
    expect(data).toHaveProperty('leaderboard');
    expect(data).toHaveProperty('ogTitle');
    expect(data).toHaveProperty('ogDescription');
  });

  it('returns leaderboard with ranked entries', async () => {
    const { result } = renderHook(() => useShareCard('share-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const lb = result.current.data!.leaderboard;
    expect(Array.isArray(lb)).toBe(true);
    expect(lb.length).toBeGreaterThan(0);
    expect(lb[0]).toHaveProperty('rank');
    expect(lb[0]).toHaveProperty('name');
    expect(lb[0]).toHaveProperty('score');
  });

  it('returns valid share card type', async () => {
    const { result } = renderHook(() => useShareCard('share-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(['contest_result', 'season_champion', 'achievement']).toContain(result.current.data!.type);
  });
});
