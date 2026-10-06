import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfTourCalendarCard } from './golf-tour-calendar-card';
import { sportEventFixture, sportLeagueFixture } from './golf-test-fixtures';

// plans/147 — a tour's tournaments by event year: the season list, the season home page,
// "set as current" and "clone to next year" all moved here when the season was collapsed into the event.

const { listEventsMock, updateSportLeagueMock, cloneEventYearMock, listProvidersMock, importEventYearFromProviderMock, mockLogger } = vi.hoisted(() => {
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
    listEventsMock: vi.fn(),
    updateSportLeagueMock: vi.fn(),
    cloneEventYearMock: vi.fn(),
    listProvidersMock: vi.fn(),
    importEventYearFromProviderMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listEvents: listEventsMock,
  updateSportLeague: updateSportLeagueMock,
  cloneEventYear: cloneEventYearMock,
  listProviders: listProvidersMock,
  importEventYearFromProvider: importEventYearFromProviderMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const TOUR = sportLeagueFixture({ id: 'pga', name: 'PGA Tour', currentEventYear: 2026 });
const EVENTS = [
  sportEventFixture({ id: 'masters-2025', name: 'The Masters', eventYear: 2025, sportLeagueId: 'pga' }),
  sportEventFixture({ id: 'masters-2026', name: 'The Masters', eventYear: 2026, sportLeagueId: 'pga' }),
  sportEventFixture({ id: 'open-2026', name: 'The Open', eventYear: 2026, sportLeagueId: 'pga' }),
];

function renderCard(tour = TOUR) {
  listEventsMock.mockResolvedValue({ data: { events: EVENTS } });
  listProvidersMock.mockResolvedValue({ data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GolfTourCalendarCard tour={tour} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('plans/147 GolfTourCalendarCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('opens on the tour\'s current year, lists only that year\'s tournaments, and marks it current', async () => {
    renderCard();

    expect(await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tour-tournament-row-open-2026')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tour-tournament-row-masters-2025')).not.toBeInTheDocument();
    expect(screen.getByText('Current year')).toBeInTheDocument();
    expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: 'pga' } }));
    expect(screen.getByTestId('root-admin-golf-tour-calendar-new-tournament')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/new?sportLeagueId=pga&eventYear=2026',
    );
  });

  it('sets another year with tournaments as current, in one update to the tour', async () => {
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: { ...TOUR, currentEventYear: 2025 } } });
    renderCard();
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    await userEvent.selectOptions(screen.getByTestId('root-admin-golf-tour-calendar-year'), '2025');
    expect(await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2025')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-set-current'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-set-current-confirm'));

    await waitFor(() => expect(updateSportLeagueMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { sportLeagueId: 'pga' }, body: { currentEventYear: 2025 } }),
    ));
  });

  it('offers no "set as current" for a year without tournaments, and shows the service refusal if it comes', async () => {
    updateSportLeagueMock.mockResolvedValue({
      error: { code: 'EVENT_YEAR_HAS_NO_EVENTS', message: 'no events' },
      response: { status: 422 },
    });
    renderCard(sportLeagueFixture({ id: 'pga', name: 'PGA Tour', currentEventYear: null }));
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    // 2027 is on offer as "next year", but has no tournaments to be current with.
    await userEvent.selectOptions(screen.getByTestId('root-admin-golf-tour-calendar-year'), '2027');
    expect(screen.getByTestId('root-admin-golf-tour-calendar-set-current')).toBeDisabled();
    expect(screen.getByTestId('root-admin-golf-tour-calendar-clone')).toBeDisabled();

    await userEvent.selectOptions(screen.getByTestId('root-admin-golf-tour-calendar-year'), '2025');
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-set-current'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-set-current-confirm'));
    expect(
      await screen.findByText('PGA Tour has no tournaments in 2025, so it cannot be the current year.'),
    ).toBeInTheDocument();
  });

  it('clones the year\'s calendar to the next year and moves to it', async () => {
    cloneEventYearMock.mockResolvedValue({
      data: { events: [sportEventFixture({ id: 'masters-2027', eventYear: 2027, sportLeagueId: 'pga' })] },
    });
    renderCard();
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-clone'));
    const modal = screen.getByTestId('root-admin-golf-tour-calendar-clone-modal');
    expect(within(modal).getByText(/2 tournaments will be copied to 2027/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-clone-confirm'));

    await waitFor(() => expect(cloneEventYearMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { sportLeagueId: 'pga', eventYear: 2026 } }),
    ));
    await waitFor(() => expect(screen.getByTestId('root-admin-golf-tour-calendar-year')).toHaveValue('2027'));
  });

  it('surfaces an EVENT_YEAR_NOT_EMPTY clone conflict with specific copy', async () => {
    cloneEventYearMock.mockResolvedValue({
      error: { code: 'EVENT_YEAR_NOT_EMPTY', message: 'not empty' },
      response: { status: 409 },
    });
    renderCard();
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-clone'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-clone-confirm'));

    expect(await screen.findByText('PGA Tour already has tournaments in 2027.')).toBeInTheDocument();
  });
  // #385 — the tour's year imported from the golf provider in one confirmed action.
  it('imports the selected year from the golf provider and says how many tournaments were created and skipped', async () => {
    importEventYearFromProviderMock.mockResolvedValue({
      data: {
        created: [sportEventFixture({ id: 'alpha-2026', eventYear: 2026, sportLeagueId: 'pga' })],
        skipped: [{ externalId: 'pga-tour-2026-masters', name: 'The Masters', reason: 'ALREADY_LINKED' }],
      },
    });
    renderCard();
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    await waitFor(() => expect(screen.getByTestId('root-admin-golf-tour-calendar-import')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-import'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-import-confirm'));

    await waitFor(() => expect(importEventYearFromProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { sportLeagueId: 'pga', eventYear: 2026, providerId: 'mock-contest-feed' } }),
    ));
    expect(await screen.findByTestId('root-admin-golf-tour-calendar-import-result'))
      .toHaveTextContent('Created 1 tournament; skipped 1 already here.');
  });

  it('says the provider listed nothing for the tour, and to check its match keyword, when the import creates and skips nothing', async () => {
    importEventYearFromProviderMock.mockResolvedValue({ data: { created: [], skipped: [] } });
    renderCard(sportLeagueFixture({ id: 'pga', name: 'PGA Tour', currentEventYear: 2026, matchKeyword: 'PGA' }));
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    await waitFor(() => expect(screen.getByTestId('root-admin-golf-tour-calendar-import')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-import'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-import-confirm'));

    expect(await screen.findByTestId('root-admin-golf-tour-calendar-import-result')).toHaveTextContent(
      'The provider lists no 2026 tournaments for the tour “PGA”. Check that PGA Tour’s match keyword is the provider’s tour name.',
    );
  });

  it('tells the admin to set the tour\'s match keyword when the import is refused for having none', async () => {
    importEventYearFromProviderMock.mockResolvedValue({
      error: { code: 'SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD', message: 'no keyword' },
      response: { status: 422 },
    });
    renderCard();
    await screen.findByTestId('root-admin-golf-tour-tournament-row-masters-2026');

    await waitFor(() => expect(screen.getByTestId('root-admin-golf-tour-calendar-import')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-import'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tour-calendar-import-confirm'));

    expect(await screen.findByText('PGA Tour has no match keyword. Set it to the provider’s tour name, such as “PGA TOUR”.'))
      .toBeInTheDocument();
  });
});
