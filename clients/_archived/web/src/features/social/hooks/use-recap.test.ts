import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useRecap } from './use-recap';

describe('useRecap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns recap data', async () => {
    const { result } = renderHook(() => useRecap('league-1', 'week-12'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveProperty('weekLabel');
    expect(result.current.data).toHaveProperty('standings');
    expect(result.current.data).toHaveProperty('highlights');
    expect(result.current.data).toHaveProperty('upcoming');
  });

  it('returns standings with expected shape', async () => {
    const { result } = renderHook(() => useRecap('league-1', 'week-12'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const standings = result.current.data!.standings;
    expect(Array.isArray(standings)).toBe(true);
    expect(standings.length).toBeGreaterThan(0);
    expect(standings[0]).toHaveProperty('rank');
    expect(standings[0]).toHaveProperty('name');
    expect(standings[0]).toHaveProperty('points');
    expect(standings[0]).toHaveProperty('change');
  });

  it('returns highlights array', async () => {
    const { result } = renderHook(() => useRecap('league-1', 'week-12'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const highlights = result.current.data!.highlights;
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0]).toHaveProperty('icon');
    expect(highlights[0]).toHaveProperty('title');
    expect(highlights[0]).toHaveProperty('detail');
  });

  it('returns upcoming events', async () => {
    const { result } = renderHook(() => useRecap('league-1', 'week-12'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const upcoming = result.current.data!.upcoming;
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming[0]).toHaveProperty('name');
    expect(upcoming[0]).toHaveProperty('dateTime');
    expect(upcoming[0]).toHaveProperty('daysUntil');
  });

  it('returns standings sorted by rank', async () => {
    const { result } = renderHook(() => useRecap('league-1', 'week-12'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const standings = result.current.data!.standings;
    for (let i = 1; i < standings.length; i++) {
      expect(standings[i].rank).toBeGreaterThan(standings[i - 1].rank);
    }
  });
});
