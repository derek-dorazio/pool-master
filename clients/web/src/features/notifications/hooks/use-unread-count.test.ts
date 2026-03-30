import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useUnreadCount } from './use-unread-count';

describe('useUnreadCount', () => {
  it('returns unread count data', async () => {
    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const counts = result.current.data!;
    expect(typeof counts.total).toBe('number');
    expect(counts.total).toBeGreaterThanOrEqual(0);
  });

  it('returns grouped category breakdown', async () => {
    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const { grouped } = result.current.data!;
    expect(grouped).toBeDefined();
    expect(typeof grouped.draft).toBe('number');
    expect(typeof grouped.scoring).toBe('number');
    expect(typeof grouped.league).toBe('number');
    expect(typeof grouped.contest).toBe('number');
    expect(typeof grouped.social).toBe('number');
    expect(typeof grouped.account).toBe('number');
  });
});
