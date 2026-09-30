import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentCreatePage } from './root-admin-golf-tournament-create-page';
import { seasonFixture, sportEventFixture, sportLeagueFixture } from './golf-test-fixtures';

// plans/124 §6.3 / §4.4a — /manage/golf/tournaments/new (pool-master-3dg).

const {
  createEventFromProviderEventMock,
  createEventMock,
  listSeasonsMock,
  listSportLeaguesMock,
  listProviderCatalogEventsMock,
  listProvidersMock,
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
    createEventFromProviderEventMock: vi.fn(),
    createEventMock: vi.fn(),
    listSeasonsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listProviderCatalogEventsMock: vi.fn(),
    listProvidersMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createEvent: createEventMock,
  createEventFromProviderEvent: createEventFromProviderEventMock,
  listSeasons: listSeasonsMock,
  listSportLeagues: listSportLeaguesMock,
  listProviderCatalogEvents: listProviderCatalogEventsMock,
  listProviders: listProvidersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function season(overrides: Parameters<typeof seasonFixture>[0] = {}) {
  return seasonFixture({
    id: 'season-1',
    sportLeagueId: 'league-1',
    sportEventCount: 3,
    createdAt: '2025-11-01T00:00:00.000Z',
    updatedAt: '2025-11-01T00:00:00.000Z',
    ...overrides,
  });
}

function renderPage(entry = '/manage/golf/tournaments/new?seasonId=season-1') {
  // #236: every golf season is read by listing the golf sport leagues, then each one's seasons.
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [sportLeagueFixture({ id: 'league-1' })] } });
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
    createEventMock.mockReset();
    createEventFromProviderEventMock.mockReset();
    listSeasonsMock.mockReset();
    listProviderCatalogEventsMock.mockReset();
    listProvidersMock.mockReset();
  });

  it('pool-master-3dg blocks creation with a link to Seasons when no golf season exists', async () => {
    listSeasonsMock.mockResolvedValue({ data: { seasons: [] } });

    renderPage('/manage/golf/tournaments/new');

    expect(
      await screen.findByText('Create a season before creating a tournament'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-golf-tournament-create-seasons-link'),
    ).toHaveAttribute('href', '/manage/golf/seasons');
  });

  it('pool-master-3dg submits a manual tournament with the season prefilled from the URL and navigates Home', async () => {
    listSeasonsMock.mockResolvedValue({ data: { seasons: [season()] } });
    createEventMock.mockResolvedValue({
      data: { event: sportEventFixture({ id: 'new-tour' }) },
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
      expect(createEventMock).toHaveBeenCalledTimes(1),
    );
    const body = (createEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body.name).toBe('Spring Classic');
    expect(body.seasonId).toBe('season-1');
    expect(body.startDate).toContain('2026-03-12T');
    expect(body.rounds).toBe(4);
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });

  it('pool-master-3dg browses provider events, selects one, and creates a linked tournament', async () => {
    listSeasonsMock.mockResolvedValue({ data: { seasons: [season()] } });
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({
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
    createEventFromProviderEventMock.mockResolvedValue({
      data: { event: sportEventFixture({ id: 'linked-tour' }) },
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
      expect(createEventFromProviderEventMock).toHaveBeenCalledTimes(1),
    );
    const body = (createEventFromProviderEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({
      seasonId: 'season-1',
      providerId: 'mock-contest-feed',
      externalId: 'pga-2026-masters',
    });
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });
});
