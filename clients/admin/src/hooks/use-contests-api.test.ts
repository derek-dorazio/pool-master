import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { adminApi } from '@/lib/api-client';
import { useContestList, useContestDetail } from './use-contests-api';

vi.mock('@/lib/api-client', () => ({
  adminApi: {
    get: vi.fn().mockRejectedValue(new Error('No backend')),
    post: vi.fn().mockRejectedValue(new Error('No backend')),
  },
}));

describe('useContestList', () => {
  beforeEach(() => {
    vi.mocked(adminApi.get).mockRejectedValue(new Error('No backend'));
  });

  it('returns contests array', async () => {
    const { result } = renderHook(() => useContestList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('each contest has required fields', async () => {
    const { result } = renderHook(() => useContestList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const contest = result.current.data[0];
    expect(contest).toHaveProperty('id');
    expect(contest).toHaveProperty('name');
    expect(contest).toHaveProperty('sport');
    expect(contest).toHaveProperty('status');
    expect(contest).toHaveProperty('entries');
    expect(contest).toHaveProperty('maxEntries');
    expect(contest).toHaveProperty('tenant');
  });

  it('filters by sport when data includes matching contests', async () => {
    const { result } = renderHook(() => useContestList({ sport: 'NFL' }));

    await waitFor(() => expect(result.current.data).toBeDefined());

    // When filtering by NFL, we should get fewer results than unfiltered
    const allResult = renderHook(() => useContestList());
    await waitFor(() => expect(allResult.result.current.data).toBeDefined());

    expect(result.current.data.length).toBeLessThanOrEqual(allResult.result.current.data.length);
    if (result.current.data.length > 0) {
      expect(result.current.data.every((c: any) => c.sport === 'NFL')).toBe(true);
    }
  });

  it('filters by status when data includes matching contests', async () => {
    const { result } = renderHook(() => useContestList({ status: 'ACTIVE' }));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const allResult = renderHook(() => useContestList());
    await waitFor(() => expect(allResult.result.current.data).toBeDefined());

    expect(result.current.data.length).toBeLessThanOrEqual(allResult.result.current.data.length);
    if (result.current.data.length > 0) {
      expect(result.current.data.every((c: any) => c.status === 'ACTIVE')).toBe(true);
    }
  });
});

describe('useContestDetail', () => {
  it('returns contest detail with standings', async () => {
    const { result } = renderHook(() => useContestDetail('c-001'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data;
    expect(data.id).toBe('c-001');
    expect(data.standings).toBeInstanceOf(Array);
    expect(data.standings.length).toBeGreaterThan(0);
  });

  it('detail includes draft status and picks', async () => {
    const { result } = renderHook(() => useContestDetail('c-001'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data;
    expect(data.draftStatus).toHaveProperty('status');
    expect(data.draftStatus).toHaveProperty('currentPick');
    expect(data.picks).toBeInstanceOf(Array);
    expect(data.picks.length).toBeGreaterThan(0);
  });
});
