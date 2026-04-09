import { waitFor } from '@testing-library/react';
import { renderHook } from '@/test-utils';
import { useUpcomingDrafts } from './use-upcoming-drafts';

vi.mock('./use-dashboard-contests', () => ({
  useDashboardContests: vi.fn(),
}));

import { useDashboardContests } from './use-dashboard-contests';

describe('useUpcomingDrafts', () => {
  it('maps snake draft contests without inventing a schedule timestamp', async () => {
    vi.mocked(useDashboardContests).mockReturnValue({
      data: [
        {
          id: 'contest-1',
          name: 'Open Draft',
          leagueName: 'Weekend League',
          selectionType: 'SNAKE_DRAFT',
          status: 'OPEN',
          startsAt: null,
        },
      ],
    } as any);

    const { result } = renderHook(() => useUpcomingDrafts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual([
      {
        id: 'contest-1',
        name: 'Open Draft',
        leagueName: 'Weekend League',
        type: 'Snake Draft',
        scheduledAt: null,
      },
    ]);
  });
});
