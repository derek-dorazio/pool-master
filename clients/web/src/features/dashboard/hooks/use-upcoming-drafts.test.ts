import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useUpcomingDrafts } from './use-upcoming-drafts';
import { vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        id: 'draft-1',
        name: 'NBA Fantasy Draft',
        leagueName: 'Hoops League',
        type: 'Snake',
        scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]),
  },
}));

describe('useUpcomingDrafts', () => {
  it('returns drafts array', async () => {
    const { result } = renderHook(() => useUpcomingDrafts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const drafts = result.current.data!;
    expect(Array.isArray(drafts)).toBe(true);
    expect(drafts.length).toBeGreaterThan(0);
  });

  it('returns drafts with expected shape', async () => {
    const { result } = renderHook(() => useUpcomingDrafts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const draft = result.current.data![0];
    expect(draft).toHaveProperty('id');
    expect(draft).toHaveProperty('name');
    expect(draft).toHaveProperty('leagueName');
    expect(draft).toHaveProperty('type');
    expect(draft).toHaveProperty('scheduledAt');
  });
});
