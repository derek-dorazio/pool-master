import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useContestPolling } from './use-contest-polling';

describe('useContestPolling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure document.hidden is false by default
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  it('returns polled contest data', async () => {
    const { result } = renderHook(() => useContestPolling({ contestId: 'c-1' }));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveProperty('standings');
    expect(result.current.data).toHaveProperty('lastUpdatedAt');
    expect(result.current.data).toHaveProperty('contestStatus');
  });

  it('returns standings with expected shape', async () => {
    const { result } = renderHook(() => useContestPolling({ contestId: 'c-1' }));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const standings = result.current.data!.standings;
    expect(Array.isArray(standings)).toBe(true);
    expect(standings.length).toBeGreaterThan(0);
    expect(standings[0]).toHaveProperty('entryId');
    expect(standings[0]).toHaveProperty('entryName');
    expect(standings[0]).toHaveProperty('rank');
    expect(standings[0]).toHaveProperty('totalScore');
    expect(standings[0]).toHaveProperty('previousRank');
  });

  it('returns valid contest status', async () => {
    const { result } = renderHook(() => useContestPolling({ contestId: 'c-1' }));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.contestStatus).toBe('ACTIVE');
  });

  it('respects enabled option', async () => {
    const { result } = renderHook(() => useContestPolling({ contestId: 'c-1', enabled: false }));

    // With enabled=false, the query should still run once (initial fetch)
    // but refetchInterval is disabled
    await waitFor(() => expect(result.current.data).toBeDefined());
  });

  it('accepts custom interval', async () => {
    const { result } = renderHook(() => useContestPolling({ contestId: 'c-1', interval: 5000 }));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.standings.length).toBeGreaterThan(0);
  });

  it('returns lastUpdatedAt as ISO string', async () => {
    const { result } = renderHook(() => useContestPolling({ contestId: 'c-1' }));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const date = new Date(result.current.data!.lastUpdatedAt);
    expect(date.getTime()).not.toBeNaN();
  });
});
