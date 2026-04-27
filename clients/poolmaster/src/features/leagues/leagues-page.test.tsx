import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePage } from './leagues-page';

const {
  listLeaguesMock,
  authState,
} = vi.hoisted(() => ({
  listLeaguesMock: vi.fn(),
  authState: {
    user: {
      id: 'user-1',
      firstName: 'Derek',
      lastName: 'Dorazio',
    },
  },
}));

vi.mock('@/lib/api', () => ({
  listLeagues: (...args: unknown[]) => listLeaguesMock(...args),
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => authState,
}));

function renderWelcomePage(initialEntries = ['/welcome']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        retryDelay: 1,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<WelcomePage />} path="/welcome" />
          <Route
            element={<div data-testid="league-home-destination">League home</div>}
            path="/league/:leagueCode"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WelcomePage', () => {
  beforeEach(() => {
    listLeaguesMock.mockReset();
  });

  it('shows the zero-league fallback and create action when the member has no leagues', async () => {
    listLeaguesMock.mockResolvedValue({
      data: {
        leagues: [],
      },
    });

    renderWelcomePage();

    expect(await screen.findByTestId('authenticated-landing-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('welcome-create-league'));
    expect(screen.getByRole('button', { name: 'Create league' })).toBeInTheDocument();
  });

  it('redirects members with leagues into the resolved league context', async () => {
    listLeaguesMock.mockResolvedValue({
      data: {
        leagues: [
          {
            id: 'league-1',
            leagueCode: 'LEAGUE1',
            name: 'League One',
            isActive: true,
            iconKey: 'TROPHY',
            memberCount: 10,
            activeContestCount: 2,
            memberType: 'MEMBER',
            leagueRelationship: { leagueMember: true, commissioner: false },
            isRootAdmin: false,
            createdAt: '2026-04-20T12:00:00.000Z',
          },
        ],
      },
    });

    renderWelcomePage();

    expect(await screen.findByTestId('league-home-destination')).toBeInTheDocument();
  });

  it('pool-master-dxd.15: uses the shared no-retry leagues query policy', async () => {
    listLeaguesMock.mockRejectedValue(new Error('League list unavailable'));

    renderWelcomePage();

    expect(await screen.findByTestId('authenticated-landing-error')).toBeInTheDocument();
    await waitFor(() => expect(listLeaguesMock).toHaveBeenCalledTimes(1));
  });
});
