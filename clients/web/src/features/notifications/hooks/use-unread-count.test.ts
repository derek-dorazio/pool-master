import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useUnreadCount } from './use-unread-count';

describe('useUnreadCount', () => {
  it('returns unread count data', async () => {
    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const counts = result.current.data!;
    // MSW returns { total: 0, grouped: {} }
    expect(typeof counts.total).toBe('number');
    expect(counts.total).toBe(0);
  });

  it('returns grouped object (empty by default from MSW)', async () => {
    const { result } = renderHook(() => useUnreadCount());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const { grouped } = result.current.data!;
    expect(grouped).toBeDefined();
    expect(typeof grouped).toBe('object');
    // MSW returns empty grouped — no category keys present
    expect(Object.keys(grouped).length).toBe(0);
  });
});
