import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useRecentActivity } from './use-recent-activity';

describe('useRecentActivity', () => {
  it('returns activity items array', async () => {
    const { result } = renderHook(() => useRecentActivity());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const items = result.current.data!;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it('returns activity items with expected shape', async () => {
    const { result } = renderHook(() => useRecentActivity());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const item = result.current.data![0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('type');
    expect(item).toHaveProperty('description');
    expect(item).toHaveProperty('relativeTime');
  });
});
