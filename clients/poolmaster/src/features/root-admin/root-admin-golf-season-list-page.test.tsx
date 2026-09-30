import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfSeasonListPage } from './root-admin-golf-season-list-page';
import { seasonFixture, sportLeagueFixture } from './golf-test-fixtures';

// plans/124 §6.3 — /manage/golf/seasons Season list (pool-master-qqs).

const {
  listSportLeaguesMock,
  listSeasonsMock,
  createSeasonMock,
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
    listSportLeaguesMock: vi.fn(),
    listSeasonsMock: vi.fn(),
    createSeasonMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  listSeasons: listSeasonsMock,
  createSeason: createSeasonMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function league(overrides: Parameters<typeof sportLeagueFixture>[0] = {}) {
  return sportLeagueFixture({ id: 'pga', currentSeasonId: 'season-2026', affiliationCount: 144, seasonCount: 2, ...overrides });
}

function season(overrides: Parameters<typeof seasonFixture>[0] = {}) {
  return seasonFixture({
    id: 'season-2026',
    sportLeagueId: 'pga',
    startDate: '2026-01-04T00:00:00.000Z',
    endDate: '2026-11-30T00:00:00.000Z',
    sportEventCount: 6,
    isCurrent: true,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...overrides,
  });
}

function renderPage(initialEntry = '/manage/golf/seasons') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RootAdminGolfSeasonListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-qqs RootAdminGolfSeasonListPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-qqs badges the season the server marks current', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
    listSeasonsMock.mockResolvedValue({
      data: {
        seasons: [
          season(),
          season({ id: 'season-2027', name: 'PGA Tour 2027', year: 2027, sportEventCount: 0, isCurrent: false }),
        ],
      },
    });

    renderPage();

    expect(await screen.findByText('PGA Tour 2026')).toBeInTheDocument();
    expect(screen.getByText('PGA Tour 2027')).toBeInTheDocument();
    // #236: the season read carries isCurrent; only that season is badged Current.
    const currentRow = screen.getByTestId('root-admin-golf-season-row-season-2026');
    const otherRow = screen.getByTestId('root-admin-golf-season-row-season-2027');
    expect(within(currentRow).getByText('Current')).toBeInTheDocument();
    expect(within(otherRow).queryByText('Current')).not.toBeInTheDocument();
    expect(within(otherRow).getByText('—')).toBeInTheDocument();
  });

  it('pool-master-qqs reads ?sportLeagueId= from the URL and filters the query', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
    listSeasonsMock.mockResolvedValue({ data: { seasons: [season()] } });

    renderPage('/manage/golf/seasons?sportLeagueId=pga');

    await screen.findByText('PGA Tour 2026');
    // #236: seasons are listed per sport league.
    expect(listSeasonsMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { sportLeagueId: 'pga' } }),
    );
    expect(screen.getByTestId('root-admin-golf-season-list-tour-filter')).toHaveValue('pga');
  });

  it('pool-master-qqs shows the tour-scoped empty state', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
    listSeasonsMock.mockResolvedValue({ data: { seasons: [] } });

    renderPage('/manage/golf/seasons?sportLeagueId=pga');

    expect(await screen.findByText('This tour has no seasons yet.')).toBeInTheDocument();
  });

  it('pool-master-qqs surfaces the load error state', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
    listSeasonsMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Season index offline' },
      response: { status: 500 },
    });

    renderPage();
    expect(await screen.findByText('Season index offline')).toBeInTheDocument();
  });

  it('pool-master-qqs creates a season through the New season modal', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [league()] } });
    listSeasonsMock.mockResolvedValue({ data: { seasons: [] } });
    createSeasonMock.mockResolvedValue({
      data: { season: season({ id: 'season-2028', name: 'PGA Tour 2028', year: 2028 }) },
    });

    renderPage();
    await screen.findByText('No golf seasons have been created yet.');

    await userEvent.click(screen.getByTestId('root-admin-golf-season-list-new'));
    await userEvent.selectOptions(
      screen.getByTestId('root-admin-golf-season-list-new-tour'),
      'pga',
    );
    await userEvent.type(
      screen.getByTestId('root-admin-golf-season-list-new-name'),
      'PGA Tour 2028',
    );
    await userEvent.clear(screen.getByTestId('root-admin-golf-season-list-new-year'));
    await userEvent.type(
      screen.getByTestId('root-admin-golf-season-list-new-year'),
      '2028',
    );
    const modal = screen.getByTestId('root-admin-golf-season-list-new-modal');
    const [startInput, endInput] = Array.from(
      modal.querySelectorAll('input[type="date"]'),
    );
    await userEvent.type(startInput, '2028-01-02');
    await userEvent.type(endInput, '2028-11-30');
    await userEvent.click(screen.getByTestId('root-admin-golf-season-list-new-save'));

    await waitFor(() =>
      expect(createSeasonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { sportLeagueId: 'pga' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
          body: expect.objectContaining({
            name: 'PGA Tour 2028',
            year: 2028,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
            startDate: expect.stringMatching(/^2028-01-02T/),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
            endDate: expect.stringMatching(/^2028-11-30T/),
          }),
        }),
      ),
    );
  });
});
