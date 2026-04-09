import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useActiveContests } from './use-active-contests';

vi.mock('./use-dashboard-contests', () => ({
  useDashboardContests: vi.fn(),
}));

import { useDashboardContests } from './use-dashboard-contests';

describe('useActiveContests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters to active contest statuses and sorts by start time', async () => {
    vi.mocked(useDashboardContests).mockReturnValue({
      data: [
        {
          id: 'contest-1',
          name: 'Open Later',
          status: 'OPEN',
          startsAt: '2026-04-10T18:00:00.000Z',
          leagueName: 'Weekend Warriors',
        },
        {
          id: 'contest-2',
          name: 'Active Soon',
          status: 'ACTIVE',
          startsAt: '2026-04-09T18:00:00.000Z',
          leagueName: 'Weekend Warriors',
        },
        {
          id: 'contest-3',
          name: 'Drafting Now',
          status: 'DRAFTING',
          startsAt: null,
          leagueName: 'Weekend Warriors',
        },
        {
          id: 'contest-4',
          name: 'Finished',
          status: 'COMPLETE',
          startsAt: '2026-04-08T18:00:00.000Z',
          leagueName: 'Weekend Warriors',
        },
      ],
    } as any);

    const { result } = renderHook(() => useActiveContests());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.map((contest) => contest.id)).toEqual([
      'contest-2',
      'contest-1',
      'contest-3',
    ]);
  });
});
