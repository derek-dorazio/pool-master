import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { ManageContestsPage } from './manage-contests-page';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getLeagueByCode: (...args: unknown[]) => getLeagueByCodeMock(...args),
  listContests: (...args: unknown[]) => listContestsMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
}));

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
        role: leagueRole,
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
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
    useSessionStore.getState().clearSession();
  });

  it('shows active and historical contests with manage links for commissioners', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-1',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'SINGLE_EVENT',
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
            contestType: 'SINGLE_EVENT',
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
    expect(screen.getByTestId('manage-contests-row-contest-1')).toBeInTheDocument();
    expect(screen.getByTestId('manage-contests-row-contest-2')).toBeInTheDocument();
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
