import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { useNotifications } from './use-notifications';

describe('useNotifications', () => {
  it('returns pages with empty items from default MSW handler', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const pages = result.current.data!.pages;
    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toHaveProperty('items');
    expect(pages[0]).toHaveProperty('nextCursor');
    // Default MSW handler returns empty items
    expect(pages[0].items).toEqual([]);
    expect(pages[0].nextCursor).toBeNull();
  });

  it('returns notification items with expected shape when server provides data', async () => {
    server.use(
      http.get('/api/v1/notifications', () => {
        return HttpResponse.json({
          items: [
            {
              id: 'n-1',
              category: 'draft',
              title: 'Draft Starting Soon',
              body: 'Your draft begins in 15 minutes.',
              read: false,
              targetUrl: '/drafts/draft-1',
              createdAt: new Date().toISOString(),
            },
          ],
          nextCursor: null,
        });
      }),
    );

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
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        const url = new URL(request.url);
        const category = url.searchParams.get('category');
        if (category === 'draft') {
          return HttpResponse.json({
            items: [
              {
                id: 'n-1',
                category: 'draft',
                title: 'Draft Starting Soon',
                body: 'Your draft begins in 15 minutes.',
                read: false,
                targetUrl: '/drafts/draft-1',
                createdAt: new Date().toISOString(),
              },
            ],
            nextCursor: null,
          });
        }
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );

    const { result } = renderHook(() => useNotifications('draft'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const items = result.current.data!.pages[0].items;
    expect(items.length).toBeGreaterThan(0);
    items.forEach((item) => {
      expect(item.category).toBe('draft');
    });
  });
});
