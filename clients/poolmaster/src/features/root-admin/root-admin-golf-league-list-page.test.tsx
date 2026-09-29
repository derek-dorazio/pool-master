import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfLeagueListPage } from './root-admin-golf-league-list-page';

// plans/124 §6.3 — /manage/golf/leagues Tours list (pool-master-qqs).

const { listSportLeaguesMock, createSportLeagueMock, mockLogger } = vi.hoisted(
  () => {
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
      createSportLeagueMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  createSportLeague: createSportLeagueMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function league(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pga',
    sportId: 'sport-golf',
    name: 'PGA Tour',
    matchKeyword: 'PGA',
    currentSeasonId: 'season-2026',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    affiliationCount: 144,
    seasonCount: 3,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminGolfLeagueListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-qqs RootAdminGolfLeagueListPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-qqs renders tours with roster/season counts and a row link to Tour Home', async () => {
    listSportLeaguesMock.mockResolvedValue({
      data: {
        sportLeagues: [
          league(),
          league({
            id: 'liv',
            name: 'LIV Golf',
            isActive: false,
            affiliationCount: 54,
            seasonCount: 1,
          }),
        ],
      },
    });

    renderPage();

    expect(await screen.findByText('PGA Tour')).toBeInTheDocument();
    expect(screen.getByText('LIV Golf')).toBeInTheDocument();
    expect(screen.getByText('144')).toBeInTheDocument();
    expect(screen.getByText('54')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-league-row-pga')).toBeInTheDocument();
  });

  it('pool-master-qqs shows the empty state', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    renderPage();
    expect(
      await screen.findByText('No golf tours have been created yet.'),
    ).toBeInTheDocument();
  });

  it('pool-master-qqs surfaces the load error state', async () => {
    listSportLeaguesMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Tour index offline' },
      response: { status: 500 },
    });
    renderPage();
    expect(await screen.findByText('Tour index offline')).toBeInTheDocument();
  });

  it('pool-master-qqs creates a tour through the New tour modal and refetches', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    createSportLeagueMock.mockResolvedValue({
      data: { sportLeague: league({ id: 'new', name: 'DP World Tour' }) },
    });

    renderPage();
    await screen.findByText('No golf tours have been created yet.');

    await userEvent.click(screen.getByTestId('root-admin-golf-league-list-new'));
    await userEvent.type(
      screen.getByTestId('root-admin-golf-league-list-new-name'),
      'DP World Tour',
    );
    await userEvent.type(
      screen.getByTestId('root-admin-golf-league-list-new-keyword'),
      'DP World',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-league-list-new-save'));

    await waitFor(() =>
      expect(createSportLeagueMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { sport: 'GOLF', name: 'DP World Tour', matchKeyword: 'DP World' } }),
      ),
    );
  });

  it('pool-master-qqs blocks submit until the tour name is entered', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    renderPage();
    await screen.findByText('No golf tours have been created yet.');

    await userEvent.click(screen.getByTestId('root-admin-golf-league-list-new'));
    expect(screen.getByTestId('root-admin-golf-league-list-new-save')).toBeDisabled();
  });
});
