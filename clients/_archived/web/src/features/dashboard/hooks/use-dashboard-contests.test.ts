import { waitFor } from '@testing-library/react';
import { renderHook } from '@/test-utils';
import { vi } from 'vitest';
import { useDashboardContests } from './use-dashboard-contests';

vi.mock('@/lib/api', () => ({
  client: {},
  listLeagues: vi.fn(),
  listContests: vi.fn(),
}));

import { listContests, listLeagues } from '@/lib/api';

describe('useDashboardContests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates contests across leagues with league names attached', async () => {
    vi.mocked(listLeagues).mockResolvedValue({
      data: {
        leagues: [
          { id: 'league-1', name: 'Weekend Warriors' },
          { id: 'league-2', name: 'Masters Pool' },
        ],
      },
      error: null,
    } as any);

    vi.mocked(listContests).mockImplementation(async ({ path }) => {
      if (path.id === 'league-1') {
        return {
          data: {
            contests: [
              {
                id: 'contest-1',
                name: 'Sunday Showdown',
                sport: 'NFL',
                status: 'ACTIVE',
                selectionType: 'SNAKE_DRAFT',
                startsAt: '2026-04-10T18:00:00.000Z',
              },
            ],
          },
          error: null,
        } as any;
      }

      return {
        data: {
          contests: [
            {
              id: 'contest-2',
              name: 'Masters Pick',
              sport: 'GOLF',
              status: 'OPEN',
              selectionType: 'SNAKE_DRAFT',
              startsAt: null,
            },
          ],
        },
        error: null,
      } as any;
    });

    const { result } = renderHook(() => useDashboardContests());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'contest-1',
        leagueName: 'Weekend Warriors',
      }),
      expect.objectContaining({
        id: 'contest-2',
        leagueName: 'Masters Pool',
      }),
    ]);
  });

  it('surfaces contest fetch errors directly', async () => {
    vi.mocked(listLeagues).mockResolvedValue({
      data: { leagues: [{ id: 'league-1', name: 'Weekend Warriors' }] },
      error: null,
    } as any);
    vi.mocked(listContests).mockResolvedValue({
      data: null,
      error: new Error('contest catalog failed'),
    } as any);

    const { result } = renderHook(() => useDashboardContests());

    await waitFor(() => expect(result.current.isError || result.current.error).toBeTruthy());
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('contest catalog failed');
  });
});
