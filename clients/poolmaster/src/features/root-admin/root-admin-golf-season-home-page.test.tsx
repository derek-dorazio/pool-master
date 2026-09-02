import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfSeasonHomePage } from './root-admin-golf-season-home-page';

// plans/124 §6.3 — /manage/golf/seasons/:seasonId Season Home (pool-master-qqs).

const {
  adminGetGolfSeasonMock,
  adminListGolfLeaguesMock,
  adminListGolfTournamentsMock,
  adminSetCurrentGolfSeasonMock,
  adminUpdateGolfSeasonMock,
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
    adminGetGolfSeasonMock: vi.fn(),
    adminListGolfLeaguesMock: vi.fn(),
    adminListGolfTournamentsMock: vi.fn(),
    adminSetCurrentGolfSeasonMock: vi.fn(),
    adminUpdateGolfSeasonMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminGetGolfSeason: adminGetGolfSeasonMock,
  adminListGolfLeagues: adminListGolfLeaguesMock,
  adminListGolfTournaments: adminListGolfTournamentsMock,
  adminSetCurrentGolfSeason: adminSetCurrentGolfSeasonMock,
  adminUpdateGolfSeason: adminUpdateGolfSeasonMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function season(overrides: Record<string, unknown> = {}) {
  return {
    id: 'season-2026',
    sportLeagueId: 'pga',
    name: 'PGA Tour 2026',
    year: 2026,
    startDate: '2026-01-04T00:00:00.000Z',
    endDate: '2026-11-30T00:00:00.000Z',
    isActive: true,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    tournamentCount: 1,
    isCurrent: false,
    ...overrides,
  };
}

function tournament(overrides: Record<string, unknown> = {}) {
  return {
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
    source: 'MANUAL',
    syncScope: 'NONE',
    scoreSource: { providerId: '', externalId: '' },
    autoLifecycleEnabled: true,
    fieldCount: 156,
    tierCount: 6,
    contestCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed(overrides: { season?: Record<string, unknown> } = {}) {
  adminGetGolfSeasonMock.mockResolvedValue({
    data: { season: season(overrides.season) },
  });
  adminListGolfLeaguesMock.mockResolvedValue({
    data: {
      leagues: [
        {
          id: 'pga',
          sportId: 'sport-golf',
          name: 'PGA Tour',
          matchKeyword: 'PGA',
          currentSeasonId: 'season-2025',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          rosterSize: 144,
          seasonCount: 2,
        },
      ],
    },
  });
  adminListGolfTournamentsMock.mockResolvedValue({
    data: {
      tournaments: [
        tournament(),
        tournament({ id: 'evt-other', name: 'Other Season Event', seasonId: 'season-2027' }),
      ],
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
    expect(screen.queryByText('Other Season Event')).not.toBeInTheDocument();
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

  it('pool-master-qqs confirms and calls adminSetCurrentGolfSeason', async () => {
    seed();
    adminSetCurrentGolfSeasonMock.mockResolvedValue({
      data: { sportLeagueId: 'pga', currentSeasonId: 'season-2026' },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-season-home-set-current'));
    await userEvent.click(
      screen.getByTestId('root-admin-golf-season-home-set-current-confirm'),
    );

    await waitFor(() =>
      expect(adminSetCurrentGolfSeasonMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { seasonId: 'season-2026' } }),
      ),
    );
  });

  it('pool-master-qqs edits the season name through the edit modal', async () => {
    seed();
    adminUpdateGolfSeasonMock.mockResolvedValue({
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
      expect(adminUpdateGolfSeasonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { seasonId: 'season-2026' },
          body: expect.objectContaining({ name: 'PGA Tour 2026 (revised)' }),
        }),
      ),
    );
  });

  it('pool-master-qqs surfaces the season load error state', async () => {
    adminGetGolfSeasonMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such season' },
      response: { status: 404 },
    });
    adminListGolfLeaguesMock.mockResolvedValue({ data: { leagues: [] } });
    adminListGolfTournamentsMock.mockResolvedValue({ data: { tournaments: [] } });
    renderPage();

    expect(await screen.findByText('No such season')).toBeInTheDocument();
  });
});
