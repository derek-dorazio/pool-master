import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useRecentActivity } from './use-recent-activity';
import { vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        id: 'activity-1',
        type: 'score_update',
        description: 'Your score in NFL Survivor Pool updated to 47 pts',
        relativeTime: '5 minutes ago',
        linkTo: '/contests/contest-1',
      },
      {
        id: 'activity-2',
        type: 'draft_pick',
        description: 'You drafted LeBron James in Hoops League',
        relativeTime: '2 hours ago',
        linkTo: '/drafts/draft-1',
      },
      {
        id: 'activity-3',
        type: 'announcement',
        description: 'Weekend Warriors: Playoff bracket posted',
        relativeTime: '1 day ago',
        linkTo: '/leagues/league-1',
      },
      {
        id: 'activity-4',
        type: 'contest_completed',
        description: 'Premier League Matchday 28 completed — you finished 1st!',
        relativeTime: '2 days ago',
        linkTo: '/contests/contest-2',
      },
      {
        id: 'activity-5',
        type: 'member_joined',
        description: 'Alex Rivera joined Soccer Fanatics',
        relativeTime: '3 days ago',
        linkTo: '/leagues/league-2',
      },
    ]),
  },
}));

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
