import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportLeagueSeasonDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { SportLeagueCalendarCard } from './sport-league-calendar-card';
import { sportEventFixture, sportLeagueFixture, sportsQueryClient } from './sport-test-fixtures';

// A tour's tournaments one Season at a time (#2003): Seasons are added by migration and a new
// tournament goes in the current Season, so the card only picks which Season to show.

const { listEventsMock, listSportLeagueSeasonsMock, mockLogger } = vi.hoisted(() => {
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
    listSportLeagueSeasonsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listEvents: listEventsMock,
  listSportLeagueSeasons: listSportLeagueSeasonsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function season(id: string, year: number): SportLeagueSeasonDto {
  return {
    id, name: String(year), championshipYear: year, startsAt: `${year}-01-01T00:00:00.000Z`, endsAt: `${year}-12-31T00:00:00.000Z`,
    isCurrent: year === 2026, providerMappings: [], phases: [],
  };
}

// Latest first, as the API lists them.
const SEASONS = [season('season-2027', 2027), season('season-2026', 2026), season('season-2025', 2025)];
const SPORT_LEAGUE = sportLeagueFixture({ id: 'pga', name: 'PGA Tour', currentSeasonId: 'season-2026' });
const EVENTS = [
  sportEventFixture({ id: 'masters-2025', name: 'The Masters', sportLeagueSeasonId: 'season-2025', championshipYear: 2025, sportLeagueId: 'pga' }),
  sportEventFixture({ id: 'masters-2026', name: 'The Masters', sportLeagueSeasonId: 'season-2026', sportLeagueId: 'pga' }),
  sportEventFixture({ id: 'open-2026', name: 'The Open', sportLeagueSeasonId: 'season-2026', sportLeagueId: 'pga' }),
];

function renderCard(sportLeague = SPORT_LEAGUE, seasons = SEASONS) {
  // The server filters by Season, so the mock does too: the card never filters a list itself.
  listEventsMock.mockImplementation(({ query }: { query: { sportLeagueSeasonId?: string } }) =>
    Promise.resolve({ data: { events: EVENTS.filter((event) => event.sportLeagueSeasonId === query.sportLeagueSeasonId) } }));
  listSportLeagueSeasonsMock.mockResolvedValue({ data: { seasons } });
  return render(
    <QueryClientProvider client={sportsQueryClient()}>
      <MemoryRouter initialEntries={[`/manage/sports/golf/leagues/${sportLeague.id}`]}>
        <Routes>
          <Route element={<SportLeagueCalendarCard sportLeague={sportLeague} />} path="/manage/sports/:sport/leagues/:leagueId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SportLeagueCalendarCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('opens on the tour\'s current Season, lists only that Season\'s tournaments, and links New tournament with no year', async () => {
    renderCard();

    expect(await screen.findByTestId('root-admin-sport-league-event-row-masters-2026')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-league-event-row-open-2026')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-league-event-row-masters-2025')).not.toBeInTheDocument();
    expect(listEventsMock).toHaveBeenCalledTimes(1);
    expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: 'pga', sportLeagueSeasonId: 'season-2026' } }));
    expect(screen.getByTestId('root-admin-sport-league-calendar-new-tournament')).toHaveAttribute(
      'href',
      '/manage/sports/golf/events/new?sportLeagueId=pga',
    );
  });

  it('titles the card after the tour\'s word for its events, as Tournament calendar for golf', async () => {
    renderCard();

    expect(await screen.findByRole('region', { name: 'Tournament calendar' })).toBeVisible();
  });

  it('offers the tour\'s Seasons by name, latest first, and asks for one Season\'s tournaments at a time, never every Season', async () => {
    renderCard();
    await screen.findByTestId('root-admin-sport-league-event-row-masters-2026');

    expect(listSportLeagueSeasonsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'pga' } }));
    const options = within(screen.getByTestId('root-admin-sport-league-calendar-season')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['2027', '2026', '2025']);

    await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-calendar-season'), 'season-2025');
    expect(await screen.findByTestId('root-admin-sport-league-event-row-masters-2025')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-league-event-row-masters-2026')).not.toBeInTheDocument();
    const seasonIds = listEventsMock.mock.calls.map(([request]) => (request as { query: { sportLeagueSeasonId?: string } }).query.sportLeagueSeasonId);
    expect(seasonIds).toEqual(['season-2026', 'season-2025']);
  });

  it('says the tour has no Season yet, loading no tournaments, when no migration has given it one', async () => {
    renderCard(sportLeagueFixture({ id: 'pga', name: 'PGA Tour', currentSeasonId: null }), []);

    expect(await screen.findByTestId('root-admin-sport-league-calendar-no-season')).toHaveTextContent('PGA Tour has no Season yet.');
    expect(listEventsMock).not.toHaveBeenCalled();
  });

  it('says the Seasons could not be loaded, instead of guessing one, when the Seasons read fails', async () => {
    // A once-value outranks the default renderCard sets.
    listSportLeagueSeasonsMock.mockResolvedValueOnce({ error: { error: { code: 'INTERNAL_ERROR', message: 'Seasons are unavailable.' } }, response: { status: 500 } });
    renderCard();

    expect(await screen.findByTestId('root-admin-sport-league-calendar-seasons-error')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-league-calendar-season')).not.toBeInTheDocument();
  });
});
