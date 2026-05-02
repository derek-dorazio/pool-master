import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootAdminManageTeamsPage } from './root-admin-manage-teams-page';

const { adminListTeamsMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);

  return {
    adminListTeamsMock: vi.fn(),
    mockLogger: logger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListTeams: (...args: unknown[]) => adminListTeamsMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminManageTeamsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminManageTeamsPage', () => {
  afterEach(() => {
    adminListTeamsMock.mockReset();
    mockLogger.info.mockReset();
  });

  it('pool-master-dxd.35 renders team rows without duplicate admin header copy', async () => {
    adminListTeamsMock.mockResolvedValue({
      data: {
        teams: [
          {
            id: 'team-active-1',
            leagueId: 'league-1',
            leagueCode: 'BIGDAWGS',
            leagueName: 'Big Dawgs',
            name: 'Beer Bellies',
            iconKey: 'CAPTAIN_SMILE_FIELD',
            isActive: true,
            ownerCount: 2,
            owners: [
              {
                userId: 'user-1',
                firstName: 'Derek',
                lastName: 'Dorazio',
              },
              {
                userId: 'user-2',
                firstName: 'Fran',
                lastName: 'Lane',
              },
            ],
            createdAt: '2026-04-11T12:00:00.000Z',
            updatedAt: '2026-04-11T12:00:00.000Z',
          },
        ],
      },
    });

    renderPage();

    expect(screen.queryByText('Back to Manage')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Filter teams by column/),
    ).not.toBeInTheDocument();
    const teamLink = await screen.findByRole('link', { name: /beer bellies/i });
    expect(teamLink).toHaveAttribute('href', '/league/BIGDAWGS/teams/team-active-1');
    expect(screen.queryByText('Open Team Home to manage lifecycle.')).not.toBeInTheDocument();
    expect(screen.getByText('Derek Dorazio, Fran Lane')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('pool-master-85r removes redundant header filters and keeps the grid filters as the only filter UI', async () => {
    adminListTeamsMock.mockResolvedValue({ data: { teams: [] } });

    renderPage();

    await waitFor(() =>
      expect(adminListTeamsMock).toHaveBeenLastCalledWith({
        query: {},
      }),
    );

    expect(screen.queryByTestId('root-admin-manage-teams-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-manage-teams-league-code')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-manage-teams-is-active-filter')).not.toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Filter Team')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter League')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter Owners')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter Lifecycle')).toBeInTheDocument();
  });
});
