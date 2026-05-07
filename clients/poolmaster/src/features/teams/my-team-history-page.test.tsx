import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { MyTeamHistoryPage } from './my-team-history-page';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
}));

function renderMyTeamHistoryPage() {
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
        <MemoryRouter initialEntries={['/league/BIGDAWGS/history']}>
          <Routes>
            <Route element={<MyTeamHistoryPage />} path="/league/:leagueCode/history" />
            <Route element={<div data-testid="team-page" />} path="/league/:leagueCode/team" />
            <Route
              element={<div data-testid="contest-page" />}
              path="/league/:leagueCode/contests/:contestId"
            />
            <Route
              element={<div data-testid="entry-page" />}
              path="/contests/:contestId/entries/:entryId"
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('MyTeamHistoryPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    listLeagueSquadsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('renders historical contest entries on the dedicated history route', async () => {
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
          activeContestCount: 2,
          memberType: 'MEMBER',
          leagueRelationship: {
            leagueMember: true,
            commissioner: false,
          },
          isRootAdmin: false,
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
            teamRelationship: {
              leagueMember: true,
              owner: true,
              commissioner: false,
            },
            isRootAdmin: false,
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
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 2,
          },
          {
            id: 'contest-complete',
            name: 'Genesis Recap',
            status: 'COMPLETED',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 3,
          },
        ],
      },
    });
    listContestEntriesMock
      .mockResolvedValueOnce({
        data: {
          contestId: 'contest-open',
          total: 2,
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
          contestId: 'contest-complete',
          total: 1,
          isJoined: true,
          myEntryId: 'entry-2',
          myEntryIds: ['entry-2'],
          entries: [
            {
              id: 'entry-2',
              contestId: 'contest-complete',
              squadId: 'team-1',
              squadName: 'Original Team',
              entryNumber: 2,
              name: 'Original Team Entry 2',
              status: 'ACTIVE',
              totalScore: 25,
              standingsPosition: 1,
              isEliminated: false,
              createdAt: '2026-04-15T00:00:00.000Z',
              updatedAt: '2026-04-15T00:00:00.000Z',
            },
          ],
        },
      });

    renderMyTeamHistoryPage();

    expect(await screen.findByTestId('my-team-history-page')).toBeInTheDocument();
    expect(await screen.findByTestId('my-team-history-contest-contest-complete')).toBeInTheDocument();
    expect(screen.getByTestId('my-team-history-entry-entry-2')).toHaveTextContent(
      'Original Team Entry 2',
    );
    expect(screen.queryByTestId('my-team-history-contest-contest-open')).not.toBeInTheDocument();
    expect(screen.queryByText('Original Team Entry 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('my-team-history-open-contest-contest-complete')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-complete',
    );
  });
});
