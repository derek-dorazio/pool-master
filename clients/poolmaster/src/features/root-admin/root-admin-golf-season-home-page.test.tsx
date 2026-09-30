import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfSeasonHomePage } from './root-admin-golf-season-home-page';
import { seasonFixture, sportEventFixture, sportLeagueFixture } from './golf-test-fixtures';

// plans/124 §6.3 — /manage/golf/seasons/:seasonId Season Home (pool-master-qqs).

const {
  getSeasonMock,
  listSportLeaguesMock,
  listEventsMock,
  setCurrentSeasonMock,
  updateSeasonMock,
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
    getSeasonMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listEventsMock: vi.fn(),
    setCurrentSeasonMock: vi.fn(),
    updateSeasonMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getSeason: getSeasonMock,
  listSportLeagues: listSportLeaguesMock,
  listEvents: listEventsMock,
  setCurrentSeason: setCurrentSeasonMock,
  updateSeason: updateSeasonMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function season(overrides: Parameters<typeof seasonFixture>[0] = {}) {
  return seasonFixture({
    id: 'season-2026',
    sportLeagueId: 'pga',
    startDate: '2026-01-04T00:00:00.000Z',
    endDate: '2026-11-30T00:00:00.000Z',
    sportEventCount: 1,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...overrides,
  });
}

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'evt-1',
    name: 'The Open',
    venue: 'Royal Liverpool',
    location: 'Hoylake',
    startDate: '2026-07-16T08:00:00.000Z',
    endDate: '2026-07-19T20:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    releaseAt: '2026-07-01T00:00:00.000Z',
    fieldLocksAt: '2026-07-15T00:00:00.000Z',
    fieldLocked: false,
    seasonId: 'season-2026',
    leagueEventId: '',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    loadedParticipantCount: 156,
    tierCount: 6,
    contestCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function seed(overrides: { season?: Parameters<typeof seasonFixture>[0] } = {}) {
  getSeasonMock.mockResolvedValue({
    data: { season: season(overrides.season) },
  });
  listSportLeaguesMock.mockResolvedValue({
    data: {
      sportLeagues: [
        sportLeagueFixture({ id: 'pga', currentSeasonId: 'season-2025', affiliationCount: 144, seasonCount: 2 }),
      ],
    },
  });
  // #236: the event list is filtered by season on the server.
  listEventsMock.mockResolvedValue({
    data: {
      events: [tournament()],
    },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/golf/seasons/season-2026']}>
        <Routes>
          <Route
            element={<RootAdminGolfSeasonHomePage />}
            path="/manage/golf/seasons/:seasonId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-qqs RootAdminGolfSeasonHomePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-qqs shows the tour, a set-current action, and only this season’s tournaments', async () => {
    seed();
    renderPage();

    expect(await screen.findByText('PGA Tour 2026')).toBeInTheDocument();
    expect(screen.getByText('PGA Tour')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-season-home-set-current')).toBeInTheDocument();
    expect(screen.getByText('The Open')).toBeInTheDocument();
    expect(listEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { seasonId: 'season-2026' } }),
    );
    expect(screen.getByTestId('root-admin-golf-season-home-new-tournament')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/new?seasonId=season-2026',
    );
  });

  it('pool-master-qqs shows the Current season badge instead of the action when isCurrent', async () => {
    seed({ season: { isCurrent: true } });
    renderPage();

    expect(await screen.findByText('Current season')).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-golf-season-home-set-current'),
    ).not.toBeInTheDocument();
  });

  it('pool-master-qqs confirms and calls setCurrentSeason', async () => {
    seed();
    setCurrentSeasonMock.mockResolvedValue({
      data: { sportLeague: sportLeagueFixture({ id: 'pga', currentSeasonId: 'season-2026' }) },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-season-home-set-current'));
    await userEvent.click(
      screen.getByTestId('root-admin-golf-season-home-set-current-confirm'),
    );

    await waitFor(() =>
      expect(setCurrentSeasonMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { seasonId: 'season-2026' } }),
      ),
    );
  });

  it('pool-master-qqs edits the season name through the edit modal', async () => {
    seed();
    updateSeasonMock.mockResolvedValue({
      data: { season: season({ name: 'PGA Tour 2026 (revised)' }) },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-season-home-edit'));
    const nameInput = screen
      .getByTestId('root-admin-golf-season-home-edit-modal')
      .querySelector('input') as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'PGA Tour 2026 (revised)');
    await userEvent.click(screen.getByTestId('root-admin-golf-season-home-edit-save'));

    await waitFor(() =>
      expect(updateSeasonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { seasonId: 'season-2026' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
          body: expect.objectContaining({ name: 'PGA Tour 2026 (revised)' }),
        }),
      ),
    );
  });

  it('pool-master-qqs surfaces the season load error state', async () => {
    getSeasonMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such season' },
      response: { status: 404 },
    });
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    listEventsMock.mockResolvedValue({ data: { events: [] } });
    renderPage();

    expect(await screen.findByText('No such season')).toBeInTheDocument();
  });
});
