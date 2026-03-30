import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useNotifications } from './use-notifications';

describe('useNotifications', () => {
  it('returns pages with notifications', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const pages = result.current.data!.pages;
    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toHaveProperty('items');
    expect(pages[0]).toHaveProperty('nextCursor');
  });

  it('returns notification items with expected shape', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const item = result.current.data!.pages[0].items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('category');
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('body');
    expect(item).toHaveProperty('read');
    expect(item).toHaveProperty('targetUrl');
    expect(item).toHaveProperty('createdAt');
  });

  it('filters notifications by category', async () => {
    const { result } = renderHook(() => useNotifications('draft'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const items = result.current.data!.pages[0].items;
    expect(items.length).toBeGreaterThan(0);
    items.forEach((item) => {
      expect(item.category).toBe('draft');
    });
  });
});
