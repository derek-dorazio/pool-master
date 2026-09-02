import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentCreatePage } from './root-admin-golf-tournament-create-page';

// plans/124 §6.3 / §4.4a — /manage/golf/tournaments/new (pool-master-3dg).

const {
  adminCreateGolfTournamentFromProviderEventMock,
  adminCreateGolfTournamentMock,
  adminListGolfSeasonsMock,
  adminListProviderCatalogEventsMock,
  adminListProvidersMock,
  mockLogger,
} = vi.hoisted(() => {
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
    adminCreateGolfTournamentFromProviderEventMock: vi.fn(),
    adminCreateGolfTournamentMock: vi.fn(),
    adminListGolfSeasonsMock: vi.fn(),
    adminListProviderCatalogEventsMock: vi.fn(),
    adminListProvidersMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminCreateGolfTournament: adminCreateGolfTournamentMock,
  adminCreateGolfTournamentFromProviderEvent: adminCreateGolfTournamentFromProviderEventMock,
  adminListGolfSeasons: adminListGolfSeasonsMock,
  adminListProviderCatalogEvents: adminListProviderCatalogEventsMock,
  adminListProviders: adminListProvidersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function season(overrides: Record<string, unknown> = {}) {
  return {
    id: 'season-1',
    sportLeagueId: 'league-1',
    name: 'PGA Tour 2026',
    year: 2026,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    isActive: true,
    createdAt: '2025-11-01T00:00:00.000Z',
    updatedAt: '2025-11-01T00:00:00.000Z',
    tournamentCount: 3,
    ...overrides,
  };
}

function renderPage(entry = '/manage/golf/tournaments/new?seasonId=season-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentCreatePage />}
            path="/manage/golf/tournaments/new"
          />
          <Route
            element={<div data-testid="tournament-home">Home</div>}
            path="/manage/golf/tournaments/:eventId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminGolfTournamentCreatePage', () => {
  afterEach(() => {
    adminCreateGolfTournamentMock.mockReset();
    adminCreateGolfTournamentFromProviderEventMock.mockReset();
    adminListGolfSeasonsMock.mockReset();
    adminListProviderCatalogEventsMock.mockReset();
    adminListProvidersMock.mockReset();
  });

  it('pool-master-3dg blocks creation with a link to Seasons when no golf season exists', async () => {
    adminListGolfSeasonsMock.mockResolvedValue({ data: { seasons: [] } });

    renderPage('/manage/golf/tournaments/new');

    expect(
      await screen.findByText('Create a season before creating a tournament'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-golf-tournament-create-seasons-link'),
    ).toHaveAttribute('href', '/manage/golf/seasons');
  });

  it('pool-master-3dg submits a manual tournament with the season prefilled from the URL and navigates Home', async () => {
    adminListGolfSeasonsMock.mockResolvedValue({ data: { seasons: [season()] } });
    adminCreateGolfTournamentMock.mockResolvedValue({
      data: { tournament: { id: 'new-tour' } },
    });

    renderPage();

    const nameInput = await screen.findByTestId('root-admin-golf-tournament-create-name');
    fireEvent.change(nameInput, { target: { value: 'Spring Classic' } });
    fireEvent.change(screen.getByTestId('root-admin-golf-tournament-create-start'), {
      target: { value: '2026-03-12T13:00' },
    });
    fireEvent.change(screen.getByTestId('root-admin-golf-tournament-create-release'), {
      target: { value: '2026-03-01T13:00' },
    });
    fireEvent.change(screen.getByTestId('root-admin-golf-tournament-create-locks'), {
      target: { value: '2026-03-11T13:00' },
    });

    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-create-submit'));

    await waitFor(() =>
      expect(adminCreateGolfTournamentMock).toHaveBeenCalledTimes(1),
    );
    const body = adminCreateGolfTournamentMock.mock.calls[0][0].body;
    expect(body.name).toBe('Spring Classic');
    expect(body.seasonId).toBe('season-1');
    expect(body.startDate).toContain('2026-03-12T');
    expect(body.rounds).toBe(4);
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });

  it('pool-master-3dg browses provider events, selects one, and creates a linked tournament', async () => {
    adminListGolfSeasonsMock.mockResolvedValue({ data: { seasons: [season()] } });
    adminListProvidersMock.mockResolvedValue({
      data: { items: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
    });
    adminListProviderCatalogEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            externalId: 'pga-2026-masters',
            name: 'The Masters 2026',
            startDate: '2026-04-09T12:00:00.000Z',
            endDate: '2026-04-12T22:00:00.000Z',
            status: 'SCHEDULED',
          },
        ],
      },
    });
    adminCreateGolfTournamentFromProviderEventMock.mockResolvedValue({
      data: { tournament: { id: 'linked-tour' } },
    });

    renderPage();

    fireEvent.click(await screen.findByRole('radio', { name: 'Browse provider events' }));

    fireEvent.click(
      await screen.findByTestId(
        'root-admin-golf-tournament-create-select-pga-2026-masters',
      ),
    );

    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-create-provider-submit'),
    );

    await waitFor(() =>
      expect(adminCreateGolfTournamentFromProviderEventMock).toHaveBeenCalledTimes(1),
    );
    const body = adminCreateGolfTournamentFromProviderEventMock.mock.calls[0][0].body;
    expect(body).toMatchObject({
      seasonId: 'season-1',
      providerId: 'mock-contest-feed',
      externalId: 'pga-2026-masters',
    });
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });
});
