import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useRecentActivity } from './use-recent-activity';
import { vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  client: {},
  listLeagues: vi.fn(),
  getLeagueFeed: vi.fn(),
}));

import { getLeagueFeed, listLeagues } from '@/lib/api';

describe('useRecentActivity', () => {
  beforeEach(() => {
    vi.mocked(listLeagues).mockResolvedValue({
      data: {
        leagues: [
          { id: 'league-1', name: 'Weekend Warriors' },
          { id: 'league-2', name: 'Masters Pool' },
        ],
      },
      error: null,
    } as any);

    vi.mocked(getLeagueFeed).mockImplementation(async ({ path }) => {
      if (path.leagueId === 'league-1') {
        return {
          data: {
            posts: [
              {
                id: 'post-1',
                leagueId: 'league-1',
                authorId: 'u-1',
                type: 'ANNOUNCEMENT',
                authorName: 'Commissioner Jane',
                content: 'Draft room opens five minutes before lock.',
                isPinned: false,
                reactions: {},
                replyCount: 0,
                createdAt: '2026-04-03T17:55:00.000Z',
                updatedAt: '2026-04-03T17:55:00.000Z',
              },
            ],
          },
          error: null,
        } as any;
      }

      return {
        data: {
          posts: [
            {
              id: 'post-2',
              leagueId: 'league-2',
              authorId: 'u-2',
              type: 'POST',
              authorName: 'Mike T.',
              content: 'Masters pricing imported and ready to review.',
              isPinned: false,
              reactions: {},
              replyCount: 0,
              createdAt: '2026-04-03T17:50:00.000Z',
              updatedAt: '2026-04-03T17:50:00.000Z',
            },
          ],
        },
        error: null,
      } as any;
    });
  });

  it('returns recent activity items aggregated from league feed posts', async () => {
    const { result } = renderHook(() => useRecentActivity());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toMatchObject({
      id: 'post-1',
      type: 'announcement',
      linkTo: '/leagues/league-1/feed',
    });
    expect(result.current.data?.[1]).toMatchObject({
      id: 'post-2',
      type: 'announcement',
      linkTo: '/leagues/league-2/feed',
    });
  });

  it('formats activity descriptions from the real feed author/content shape', async () => {
    const { result } = renderHook(() => useRecentActivity());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.[0]?.description).toBe('Commissioner Jane: Draft room opens five minutes before lock.');
    expect(result.current.data?.[1]?.description).toBe('Mike T.: Masters pricing imported and ready to review.');
    expect(result.current.data?.every((item) => typeof item.relativeTime === 'string')).toBe(true);
  });

  it('keeps only the five newest feed items across leagues', async () => {
    vi.mocked(listLeagues).mockResolvedValue({
      data: {
        leagues: [{ id: 'league-1', name: 'Weekend Warriors' }],
      },
      error: null,
    } as any);

    vi.mocked(getLeagueFeed).mockResolvedValue({
      data: {
        posts: Array.from({ length: 6 }, (_, index) => ({
          id: `post-${index + 1}`,
          leagueId: 'league-1',
          authorId: `u-${index + 1}`,
          type: 'SYSTEM',
          authorName: 'System',
          content: `Update ${index + 1}`,
          isPinned: false,
          reactions: {},
          replyCount: 0,
          createdAt: `2026-04-03T17:${55 - index}:00.000Z`,
          updatedAt: `2026-04-03T17:${55 - index}:00.000Z`,
        })),
      },
      error: null,
    } as any);

    const { result } = renderHook(() => useRecentActivity());

    await waitFor(() => expect(result.current.data).toHaveLength(5));
    expect(result.current.data?.map((item) => item.id)).toEqual([
      'post-1',
      'post-2',
      'post-3',
      'post-4',
      'post-5',
    ]);
  });
});
