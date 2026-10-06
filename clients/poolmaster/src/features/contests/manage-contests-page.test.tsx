import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { ManageContestsPage } from './manage-contests-page';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContests: listContestsMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
});

function renderManageContestsPage() {
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
        <MemoryRouter initialEntries={['/league/BIGDAWGS/contests/manage']}>
          <Routes>
            <Route
              element={<ManageContestsPage />}
              path="/league/:leagueCode/contests/manage"
            />
            <Route
              element={<div data-testid="manage-contest-destination" />}
              path="/league/:leagueCode/contests/:contestId/manage"
            />
            <Route
              element={<div data-testid="contest-destination" />}
              path="/league/:leagueCode/contests/:contestId"
            />
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
            <Route element={<div data-testid="welcome-destination" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCommonMocks({
  isRootAdmin = false,
  leagueRole = 'COMMISSIONER',
}: {
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
} = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        firstName: 'Casey',
        lastName: 'Commissioner',
        isActive: true,
        isRootAdmin,
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
        description: 'A commissioner-run league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 12,
        activeContestCount: 2,
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      // #202 (A8) — the viewer's own membership, delivered once with the league context. It was
      // `memberType` and a `leagueRelationship` block on the league itself.
      membership: {
        id: 'league-membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          username: 'user@example.com',
          firstName: 'Casey',
          lastName: 'Commissioner',
          isActive: true,
          isRootAdmin,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
        role: leagueRole,
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
      squadMembership: null,
    },
  });
}

describe('ManageContestsPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('shows active and historical contests, each with its readable status, and manage links for commissioners', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-1',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 12,
          },
          {
            id: 'contest-2',
            name: 'Players Championship',
            status: 'COMPLETED',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 10,
          },
        ],
      },
    });

    renderManageContestsPage();

    expect(await screen.findByTestId('manage-contests-page')).toBeInTheDocument();
    expect(screen.getByTestId('manage-contests-create-link')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/new',
    );
    expect(await screen.findByTestId('manage-contests-row-contest-1')).toHaveTextContent(
      'TIERED · STROKE_PLAY · Open for entries',
    );
    expect(screen.getByTestId('manage-contests-row-contest-2')).toHaveTextContent(
      'TIERED · STROKE_PLAY · Final',
    );
    expect(screen.getByTestId('manage-contests-open-contest-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );
    expect(screen.getByTestId('manage-contests-manage-contest-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1/manage',
    );
  });

  it('shows a truthful access-denied state for members without commissioner authority', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [],
      },
    });

    renderManageContestsPage();

    expect(await screen.findByTestId('manage-contests-access-denied')).toBeInTheDocument();
    expect(screen.getByText(/does not include contest-management authority/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open League Home' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS',
    );
  });
});
