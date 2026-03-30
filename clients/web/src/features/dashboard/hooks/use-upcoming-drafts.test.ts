import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useUpcomingDrafts } from './use-upcoming-drafts';

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
