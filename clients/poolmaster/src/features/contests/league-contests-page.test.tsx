import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { LeagueContestsPage } from './league-contests-page';

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

function renderLeagueContestsPage() {
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
        <MemoryRouter initialEntries={['/league/BIGDAWGS/contests']}>
          <Routes>
            <Route element={<LeagueContestsPage />} path="/league/:leagueCode/contests" />
            <Route element={<div data-testid="contest-destination" />} path="/league/:leagueCode/contests/:contestId" />
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCommonMocks({
  isRootAdmin = false,
  leagueRole = 'MEMBER',
}: {
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
} = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'member@example.com',
        firstName: 'Mina',
        lastName: 'Member',
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
        description: 'A contest-ready league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 12,
        activeContestCount: 2,
        memberType: leagueRole,
        leagueRelationship: {
          leagueMember: true,
          commissioner: leagueRole === 'COMMISSIONER',
        },
        isRootAdmin,
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
}

describe('LeagueContestsPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('pool-master-7j3 and pool-master-9r6 show active contests and history on League Contests', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
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

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contests-page')).toBeInTheDocument();
    expect(screen.queryByText(/Contest cards and commissioner contest actions are available from League Home/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open League Home' })).not.toBeInTheDocument();

    expect(await screen.findByTestId('league-contests-active')).toHaveTextContent('Masters Pick 6');
    expect(screen.getByTestId('league-contests-active')).toHaveTextContent('12 entries');
    expect(screen.getByTestId('league-contests-history')).toHaveTextContent('Players Championship');
    expect(screen.getByTestId('league-contests-history')).toHaveTextContent('10 entries');
    expect(screen.getByTestId('league-contest-contest-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );
    expect(screen.getByTestId('league-history-contest-contest-2')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-2',
    );
  });
});
