import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { MyEntriesPage } from './my-entries-page';

const enterContestMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateContestEntryMock = vi.fn();

vi.mock('@/lib/api', () => ({
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  updateContestEntry: (...args: unknown[]) => updateContestEntryMock(...args),
}));

function renderMyEntriesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/league/BIGDAWGS/entries']}>
          <Routes>
            <Route element={<MyEntriesPage />} path="/league/:leagueCode/entries" />
            <Route
              element={<div data-testid="contest-entry-page" />}
              path="/contests/:contestId/entries/:entryId"
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('MyEntriesPage', () => {
  afterEach(() => {
    enterContestMock.mockReset();
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    updateContestEntryMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('prompts the user to create a team before managing entries', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 1,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });

    renderMyEntriesPage();

    expect(await screen.findByText('Create your team first')).toBeInTheDocument();
    expect(screen.getByTestId('my-entries-open-team')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/team',
    );
  });

  it('creates another contest entry for the current team from the dedicated entries page', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 1,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          {
            id: 'team-1',
            leagueId: 'league-1',
            createdBy: 'user-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            status: 'ACTIVE',
            memberCount: 1,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-open',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'SINGLE_EVENT',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 1,
          },
        ],
      },
    });
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-open',
        total: 1,
        isJoined: true,
        myEntryId: 'entry-1',
        myEntryIds: ['entry-1'],
        entries: [
          {
            id: 'entry-1',
            contestId: 'contest-open',
            squadId: 'team-1',
            squadName: 'Original Team',
            entryNumber: 1,
            name: 'Original Team Entry 1',
            status: 'ACTIVE',
            totalScore: 12,
            standingsPosition: 2,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });
    enterContestMock.mockResolvedValue({
      data: {
        contestId: 'contest-open',
        entry: {
          id: 'entry-2',
          contestId: 'contest-open',
          squadId: 'team-1',
          squadName: 'Original Team',
          entryNumber: 2,
          name: 'Original Team Entry 2',
          status: 'ACTIVE',
          totalScore: 0,
          standingsPosition: undefined,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });

    renderMyEntriesPage();

    expect(await screen.findByTestId('my-entries-create-entry-contest-open')).toHaveTextContent(
      'Create entry',
    );
    fireEvent.click(screen.getByTestId('my-entries-create-entry-contest-open'));

    await waitFor(() =>
      expect(enterContestMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-open' },
      }),
    );
  });

  it('renames a team-owned contest entry from the dedicated entries page while the contest is open', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
          name: 'Big Dawgs',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 2,
          activeContestCount: 1,
          role: 'MEMBER',
          joinPolicy: 'COMMISSIONER_ONLY',
          createdAt: '2026-04-15T00:00:00.000Z',
        },
      },
    });
    listLeagueSquadsMock.mockResolvedValue({
      data: {
        squads: [
          {
            id: 'team-1',
            leagueId: 'league-1',
            createdBy: 'user-1',
            name: 'Original Team',
            iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
            status: 'ACTIVE',
            memberCount: 1,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
            members: [
              {
                id: 'membership-1',
                squadId: 'team-1',
                leagueId: 'league-1',
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
                status: 'ACTIVE',
                joinedAt: '2026-04-15T00:00:00.000Z',
                createdAt: '2026-04-15T00:00:00.000Z',
                updatedAt: '2026-04-15T00:00:00.000Z',
              },
            ],
          },
        ],
      },
    });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-open',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'SINGLE_EVENT',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 1,
          },
        ],
      },
    });
    listContestEntriesMock
      .mockResolvedValueOnce({
        data: {
          contestId: 'contest-open',
          total: 1,
          isJoined: true,
          myEntryId: 'entry-1',
          myEntryIds: ['entry-1'],
          entries: [
            {
              id: 'entry-1',
              contestId: 'contest-open',
              squadId: 'team-1',
              squadName: 'Original Team',
              entryNumber: 1,
              name: 'Original Team Entry 1',
              status: 'ACTIVE',
              totalScore: 12,
              standingsPosition: 2,
              isEliminated: false,
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T00:00:00.000Z',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          contestId: 'contest-open',
          total: 1,
          isJoined: true,
          myEntryId: 'entry-1',
          myEntryIds: ['entry-1'],
          entries: [
            {
              id: 'entry-1',
              contestId: 'contest-open',
              squadId: 'team-1',
              squadName: 'Original Team',
              entryNumber: 1,
              name: 'Sunday Charge',
              status: 'ACTIVE',
              totalScore: 12,
              standingsPosition: 2,
              isEliminated: false,
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-16T00:00:00.000Z',
            },
          ],
        },
      });
    updateContestEntryMock.mockResolvedValue({
      data: {
        contestId: 'contest-open',
        entry: {
          id: 'entry-1',
          contestId: 'contest-open',
          squadId: 'team-1',
          squadName: 'Original Team',
          entryNumber: 1,
          name: 'Sunday Charge',
          status: 'ACTIVE',
          totalScore: 12,
          standingsPosition: 2,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });

    renderMyEntriesPage();

    expect(await screen.findByTestId('my-entries-name-edit-entry-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-entries-name-edit-entry-1'));
    fireEvent.change(screen.getByTestId('my-entries-name-input-entry-1'), {
      target: { value: 'Sunday Charge' },
    });
    fireEvent.click(screen.getByTestId('my-entries-name-save-entry-1'));

    await waitFor(() =>
      expect(updateContestEntryMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-open', entryId: 'entry-1' },
        body: { name: 'Sunday Charge' },
      }),
    );

    expect(await screen.findByTestId('my-entries-entry-entry-1')).toHaveTextContent(
      'Sunday Charge',
    );
  });
});
