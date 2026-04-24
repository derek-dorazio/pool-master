import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacyContestDetailRedirect } from './legacy-contest-detail-redirect';

const {
  getContestMock,
  getLeagueMock,
} = vi.hoisted(() => ({
  getContestMock: vi.fn(),
  getLeagueMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getContest: (...args: unknown[]) => getContestMock(...args),
  getLeague: (...args: unknown[]) => getLeagueMock(...args),
}));

vi.mock('./contest-detail-page', () => ({
  ContestDetailPage: () => <div data-testid="contest-detail-page">Contest Detail</div>,
}));

function renderRedirect(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            element={<LegacyContestDetailRedirect />}
            path="/contests/:contestId"
          />
          <Route
            element={<div data-testid="canonical-contest-route">Canonical contest route</div>}
            path="/league/:leagueCode/contests/:contestId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LegacyContestDetailRedirect', () => {
  beforeEach(() => {
    getContestMock.mockReset();
    getLeagueMock.mockReset();
  });

  it('redirects old contest URLs onto the canonical league-scoped route', async () => {
    getContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-1',
          leagueId: 'league-1',
        },
      },
    });
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDOGS',
        },
      },
    });

    renderRedirect(['/contests/contest-1']);

    expect(await screen.findByTestId('canonical-contest-route')).toBeInTheDocument();
  });
});
