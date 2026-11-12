import { CONTEST_EVENTS_LOCKED } from '@poolmaster/shared/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto, SportEventDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  getLeagueByCodeData,
} from '@/features/leagues/test/fixtures';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { ContestEventsPage } from './contest-events-page';
import {
  buildContest,
  buildContestSportEvent,
  buildManagedContest,
  buildSportEvent,
} from './test/contest-admin-fixtures';

const getCurrentUserMock = vi.fn();
const getEventMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const getContestMock = vi.fn();
const listEventsMock = vi.fn();
const listEventYearsMock = vi.fn();
const refreshTokenMock = vi.fn();
const setContestSportEventsMock = vi.fn();

bindApiMocks({
  getEvent: getEventMock,
  getLeagueByCode: getLeagueByCodeMock,
  getUser: getCurrentUserMock,
  getContest: getContestMock,
  listEvents: listEventsMock,
  listEventYears: listEventYearsMock,
  refreshToken: refreshTokenMock,
  setContestSportEvents: setContestSportEventsMock,
});

const SPORT_LEAGUE_ID = '00000000-0000-4000-8000-000000000002';

// One golf season of the contest's sport league, listed out of start order on purpose.
const masters = buildSportEvent({ id: 'event-1', name: 'The Masters', startDate: '2099-04-09T12:40:00.000Z', eventYear: 2099 });
const usOpen = buildSportEvent({ id: 'event-3', name: 'U.S. Open', startDate: '2099-06-18T12:00:00.000Z', eventYear: 2099 });
const pga = buildSportEvent({ id: 'event-2', name: 'PGA Championship', startDate: '2099-05-14T12:00:00.000Z', eventYear: 2099 });
const openChampionship = buildSportEvent({
  id: 'event-4',
  name: 'The Open',
  startDate: '2099-07-16T12:00:00.000Z',
  eventYear: 2099,
  contestEligible: false,
  readinessStatus: 'PENDING_FIELD',
});
const nextSeasonMasters = buildSportEvent({ id: 'event-9', name: 'The Masters 2100', startDate: '2100-04-08T12:40:00.000Z', eventYear: 2100 });

const contestOnMasters = buildContest({
  status: 'OPEN',
  sportEvents: [buildContestSportEvent({ sportEventId: 'event-1', name: 'The Masters', startDate: masters.startDate })],
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<MemberRouteGuard />}>
              <Route element={<CommissionerRouteGuard />} path="/league/:leagueCode/admin">
                <Route element={<div data-testid="manage-contest-destination" />} path="contests/:contestId" />
                <Route element={<ContestEventsPage />} path="contests/:contestId/events" />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeMocks({
  contest = contestOnMasters,
  firstEvent = masters,
  leagueEvents = [usOpen, masters, openChampionship, pga, nextSeasonMasters],
}: {
  contest?: ContestDto;
  firstEvent?: SportEventDto;
  leagueEvents?: SportEventDto[];
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership() },
  )));
  getContestMock.mockResolvedValue(apiSuccess({ contest }));
  getEventMock.mockResolvedValue(apiSuccess({ event: firstEvent }));
  // The server narrows the list to the season asked for, and lists the seasons on their own.
  listEventsMock.mockImplementation(({ query }: { query: { eventYear: number } }) => apiSuccess({
    events: leagueEvents.filter((event) => event.eventYear === query.eventYear),
  }));
  listEventYearsMock.mockResolvedValue(apiSuccess({
    years: [...new Set(leagueEvents.map((event) => event.eventYear))].sort((left, right) => left - right),
  }));
}

const EVENTS_PATH = '/league/BIGDAWGS/admin/contests/contest-1/events';

function option(eventId: string) {
  return screen.getByTestId(`contest-events-option-${eventId}`);
}

afterEach(() => {
  for (const mock of [
    getCurrentUserMock, getEventMock, getLeagueByCodeMock, getContestMock, listEventsMock, listEventYearsMock,
    refreshTokenMock, setContestSportEventsMock,
  ]) {
    mock.mockReset();
  }
});

describe('Commissioner tools › Contests › one contest › Events', () => {
  it('reads the sport league\'s seasons and only the contest\'s season of events, never every season at once', async () => {
    primeMocks();

    renderAt(EVENTS_PATH);

    await screen.findByTestId('contest-events-options');
    expect(listEventYearsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: SPORT_LEAGUE_ID } }));
    expect(listEventsMock).toHaveBeenCalledTimes(1);
    expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: SPORT_LEAGUE_ID, eventYear: 2099 } }));
    expect(within(screen.getByTestId('contest-events-year')).getAllByRole('option').map((year) => year.textContent)).toEqual(['2099', '2100']);
  });

  it('says the season\'s events could not load, in red with Retry, and lists them once Retry succeeds', async () => {
    primeMocks();
    const listSeason = listEventsMock.getMockImplementation() as (options: unknown) => unknown;
    listEventsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } }, status: 500 });

    renderAt(EVENTS_PATH);

    const error = await screen.findByTestId('contest-events-year-error');
    expect(error).toHaveTextContent("We couldn't load the 2099 events.");
    listEventsMock.mockImplementation(listSeason);
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId(`contest-events-option-${masters.id}`)).toBeInTheDocument();
  });

  it('reads another season\'s events when it is picked, keeping the events chosen in the first season in the order list', async () => {
    primeMocks();

    renderAt(EVENTS_PATH);

    fireEvent.click(await screen.findByTestId('contest-events-option-event-2'));
    fireEvent.change(screen.getByTestId('contest-events-year'), { target: { value: '2100' } });

    await waitFor(() => expect(option('event-9')).toBeInTheDocument());
    expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: SPORT_LEAGUE_ID, eventYear: 2100 } }));
    fireEvent.click(option('event-9'));
    expect(screen.getByTestId('contest-events-chosen')).toHaveTextContent('3 events, in order');
    expect(screen.getByTestId('contest-events-chosen')).toHaveTextContent(/The Masters.*PGA Championship.*The Masters 2100/);
  });

  it('lists the first event\'s sport league events for its season in start order, with the contest\'s own event checked', async () => {
    primeMocks();

    renderAt(EVENTS_PATH);

    await screen.findByTestId('contest-events-option-event-1');
    const options = within(screen.getByTestId('contest-events-options'));
    expect(options.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
      'The Masters', 'PGA Championship', 'U.S. Open', 'The Open',
    ]);
    expect(screen.queryByText('The Masters 2100')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-events-year')).toHaveValue('2099');
    expect(option('event-1')).toBeChecked();
    expect(option('event-2')).not.toBeChecked();
    // An event whose field is not loaded can't be added yet, and says why.
    expect(option('event-4')).toBeDisabled();
    expect(options.getByText(/Field not loaded yet/)).toBeInTheDocument();
  });

  it('numbers the chosen events in play order in their own section, and asks for one when none is chosen', async () => {
    primeMocks();

    renderAt(EVENTS_PATH);

    fireEvent.click(await screen.findByTestId('contest-events-option-event-2'));
    const chosen = within(screen.getByRole('region', { name: '2 events, in order' }));
    expect(chosen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^The Masters.*1$/),
      expect.stringMatching(/^PGA Championship.*2$/),
    ]);
    fireEvent.click(option('event-1'));
    fireEvent.click(option('event-2'));
    expect(screen.getByTestId('contest-events-chosen-empty')).toHaveTextContent('Choose at least one event.');
  });

  it('counts the season\'s chosen events in its title and highlights their rows as they are ticked', async () => {
    primeMocks();

    renderAt(EVENTS_PATH);

    await screen.findByTestId('contest-events-option-event-1');
    expect(screen.getByTestId('contest-events-chosen-count')).toHaveTextContent('1 chosen');
    expect(screen.getByTestId('contest-events-row-event-1')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('contest-events-row-event-2')).not.toHaveAttribute('aria-current');
    fireEvent.click(option('event-2'));
    expect(screen.getByTestId('contest-events-chosen-count')).toHaveTextContent('2 chosen');
    expect(screen.getByTestId('contest-events-row-event-2')).toHaveAttribute('aria-current', 'true');
  });

  it('shows a season that could not load inside that season\'s section', async () => {
    primeMocks();
    listEventsMock.mockImplementation(() => Promise.resolve({ error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } }, status: 500 }));

    renderAt(EVENTS_PATH);

    const error = await screen.findByTestId('contest-events-year-error');
    expect(within(screen.getByRole('region', { name: '2099 events' })).getByTestId('contest-events-year-error')).toBe(error);
  });

  it('reads the one contest by id and goes back to the contest page for a contest of another league', async () => {
    primeMocks({ contest: { ...contestOnMasters, leagueId: 'league-elsewhere' } });

    renderAt(EVENTS_PATH);

    expect(await screen.findByTestId('manage-contest-destination')).toBeInTheDocument();
    expect(getContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
  });

  it('adds every contest-eligible event of the season not yet chosen on "Add all", leaving the ineligible one out', async () => {
    primeMocks();

    renderAt(EVENTS_PATH);

    await screen.findByTestId('contest-events-option-event-1');
    const addAll = screen.getByTestId('contest-events-add-all');
    expect(addAll).toHaveTextContent('Add all 2');
    fireEvent.click(addAll);

    expect(option('event-1')).toBeChecked();
    expect(option('event-2')).toBeChecked();
    expect(option('event-3')).toBeChecked();
    expect(option('event-4')).not.toBeChecked();
    expect(screen.getByTestId('contest-events-add-all')).toBeDisabled();
    expect(screen.getByTestId('contest-events-chosen')).toHaveTextContent('3 events, in order');
  });

  it('saves the chosen events in start order, whatever order they were ticked in, then returns to the contest page', async () => {
    primeMocks();
    setContestSportEventsMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest() }));

    renderAt(EVENTS_PATH);

    fireEvent.click(await screen.findByTestId('contest-events-option-event-3'));
    fireEvent.click(option('event-2'));
    const chosen = within(screen.getByTestId('contest-events-chosen')).getAllByRole('listitem');
    expect(chosen.map((item) => within(item).getByText(/^(The Masters|PGA Championship|U\.S\. Open)$/).textContent)).toEqual(['The Masters', 'PGA Championship', 'U.S. Open']);
    fireEvent.click(screen.getByTestId('contest-events-save'));

    await waitFor(() => expect(setContestSportEventsMock).toHaveBeenCalledWith({
      path: { id: 'league-1', contestId: 'contest-1' },
      body: { sportEventIds: ['event-1', 'event-2', 'event-3'] },
    }));
    expect(await screen.findByTestId('manage-contest-destination')).toBeInTheDocument();
  });

  it('keeps a started contest\'s events checked and locked, while still letting new events be added', async () => {
    const startedMasters = buildSportEvent({
      ...masters,
      status: 'IN_PROGRESS',
      startDate: '2020-04-09T12:40:00.000Z',
      contestEligible: false,
      readinessStatus: 'EVENT_STARTED',
    });
    primeMocks({
      contest: buildContest({
        status: 'ACTIVE',
        sportEvents: [buildContestSportEvent({ startDate: startedMasters.startDate, status: 'IN_PROGRESS' })],
      }),
      firstEvent: startedMasters,
      leagueEvents: [startedMasters, pga],
    });

    renderAt(EVENTS_PATH);

    const lockedOption = await screen.findByTestId('contest-events-option-event-1');
    expect(lockedOption).toBeChecked();
    expect(lockedOption).toBeDisabled();
    expect(screen.getByText('In the contest')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('contest-events-page-help'));
    expect(screen.getByTestId('contest-events-page-help-callout')).toHaveTextContent('you can add events but not remove them');

    // Adding still works, and the save keeps the started event.
    setContestSportEventsMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest() }));
    fireEvent.click(option('event-2'));
    fireEvent.click(screen.getByTestId('contest-events-save'));
    await waitFor(() => expect(setContestSportEventsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { sportEventIds: ['event-1', 'event-2'] },
    })));
  });

  it('stays on the page and says why when the server refuses the save because an event has started', async () => {
    primeMocks();
    setContestSportEventsMock.mockResolvedValue({
      error: { error: { code: CONTEST_EVENTS_LOCKED, message: 'server sentence' } },
      response: { status: 409 },
    });

    renderAt(EVENTS_PATH);

    fireEvent.click(await screen.findByTestId('contest-events-option-event-2'));
    fireEvent.click(screen.getByTestId('contest-events-save'));

    expect(await screen.findByText('An event in this contest has started, so its events can no longer be removed.')).toBeInTheDocument();
    expect(screen.queryByText('server sentence')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manage-contest-destination')).not.toBeInTheDocument();
  });
});
