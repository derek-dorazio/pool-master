import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import { bracketLeagueContextFixture } from './test/bracket-fixtures';
import {
  NFL_TEAMS,
  pickEmContestFixture,
  pickEmEntriesFixture,
  pickEmWeekFixture,
  playoffSurvivorContestFixture,
  playoffSurvivorFixture,
  survivorWeekFixture,
  week1Games,
  weekPick,
} from './test/pick-em-fixtures';

const {
  getContestMock,
  getGamePicksMock,
  getLeagueMock,
  getSelectionStateMock,
  listContestEntriesMock,
  mockLogger,
  saveGamePicksMock,
  submitGamePicksMock,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getContestMock: vi.fn(),
    getGamePicksMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getSelectionStateMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
    saveGamePicksMock: vi.fn(),
    submitGamePicksMock: vi.fn(),
  };
});

bindApiMocks({
  getContest: getContestMock,
  getGamePicks: getGamePicksMock,
  getLeague: getLeagueMock,
  getSelectionState: getSelectionStateMock,
  listContestEntries: listContestEntriesMock,
  saveGamePicks: saveGamePicksMock,
  submitGamePicks: submitGamePicksMock,
});

// The league-context hook reads the cached session user; the page renders bare here.
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'member@example.com',
      username: 'member@example.com',
      firstName: 'Morgan',
      lastName: 'Member',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    clearSession: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderPickEmEntry(entryId = 'entry-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/league/BIGDAWGS/contests/contest-1/entries/${entryId}`]}>
        <Routes>
          <Route element={<ContestEntryPage />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks({ week = pickEmWeekFixture() } = {}) {
  getContestMock.mockResolvedValue({ data: { contest: pickEmContestFixture() } });
  getGamePicksMock.mockResolvedValue({ data: week });
  listContestEntriesMock.mockResolvedValue({ data: pickEmEntriesFixture() });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
}

function savedBody(call = 0) {
  const [request] = saveGamePicksMock.mock.calls[call] as [{ body: Record<string, unknown> }];
  return request.body;
}

const team = (matchNumber: number, sportEventParticipantId: string) =>
  screen.getByTestId(`pick-em-game-${matchNumber}-team-${sportEventParticipantId}`);

describe('Pick\'em contest entry page', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      listContestEntriesMock, saveGamePicksMock, submitGamePicksMock,
    ]) {
      mock.mockReset();
    }
  });

  it('opens on the week being picked, lists its games in kickoff order with the away team first, and never reads the roster selection room', async () => {
    primeMocks();
    renderPickEmEntry();

    await screen.findByTestId('pick-em-games');
    expect(getGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'week-1' },
    }));
    const games = within(screen.getByTestId('pick-em-games')).getAllByRole('listitem').map((item) => item.getAttribute('data-testid'));
    expect(games).toEqual(['pick-em-game-2', 'pick-em-game-3', 'pick-em-game-1']);
    const sunday = within(screen.getByTestId('pick-em-game-2')).getAllByRole('button').map((button) => button.textContent);
    expect(sunday).toEqual(['Bills', 'Chiefs']);
    expect(screen.getByTestId('pick-em-picked-count')).toHaveTextContent('0 of 3 picked');
    expect(getSelectionStateMock).not.toHaveBeenCalled();
  });

  it('warns that a draft week scores nothing unless it is submitted before the first kickoff, and says what is left before it can be', async () => {
    primeMocks();
    renderPickEmEntry();

    expect(await screen.findByTestId('pick-em-not-submitted-warning')).toHaveTextContent('A week that isn\'t submitted by then scores nothing.');
    expect(screen.getByTestId('pick-em-submit-hint')).toHaveTextContent('Pick every game to submit: 3 still to pick.');
    expect(screen.getByTestId('pick-em-submit')).toBeDisabled();
  });

  it('saves a tapped team as the game\'s pick and shows the week the server answers with', async () => {
    primeMocks();
    saveGamePicksMock.mockResolvedValue({
      data: pickEmWeekFixture({ games: week1Games({ 2: { pick: weekPick(NFL_TEAMS.chiefs) } }) }),
    });
    renderPickEmEntry();

    fireEvent.click(await screen.findByTestId(`pick-em-game-2-team-${NFL_TEAMS.chiefs.sportEventParticipantId}`));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({ picks: [{ sportEventMatchId: 'match-2', sportEventParticipantId: NFL_TEAMS.chiefs.sportEventParticipantId }] });
    await waitFor(() => expect(team(2, NFL_TEAMS.chiefs.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('pick-em-picked-count')).toHaveTextContent('1 of 3 picked');
  });

  it('takes the tiebreaker on the week\'s last game only, and saves it with no picks', async () => {
    primeMocks();
    saveGamePicksMock.mockResolvedValue({ data: pickEmWeekFixture({ tiebreakerValue: 44 }) });
    renderPickEmEntry();

    const monday = await screen.findByTestId('pick-em-game-1');
    expect(within(monday).getByTestId('pick-em-tiebreaker-input')).toBeInTheDocument();
    expect(within(monday).getByText(/Total points in Bears at Packers/)).toBeInTheDocument();
    expect(within(screen.getByTestId('pick-em-game-2')).queryByTestId('pick-em-tiebreaker-input')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('pick-em-tiebreaker-input'), { target: { value: '44' } });
    fireEvent.click(screen.getByTestId('pick-em-tiebreaker-save'));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({ picks: [], tiebreakerValue: 44 });
    expect(await screen.findByTestId('pick-em-tiebreaker-saved')).toHaveTextContent('Saved tiebreaker: 44 total points.');
  });

  it('submits a week with every game picked and its tiebreaker saved, then says the week counts', async () => {
    const picked = week1Games({
      1: { pick: weekPick(NFL_TEAMS.packers) },
      2: { pick: weekPick(NFL_TEAMS.chiefs) },
      3: { pick: weekPick(NFL_TEAMS.eagles) },
    });
    primeMocks({ week: pickEmWeekFixture({ games: picked, tiebreakerValue: 44, canSubmit: true }) });
    submitGamePicksMock.mockResolvedValue({
      data: pickEmWeekFixture({ games: picked, tiebreakerValue: 44, status: 'SUBMITTED', submittedAt: '2099-09-02T12:00:00.000Z' }),
    });
    renderPickEmEntry();

    expect(await screen.findByTestId('pick-em-submit')).toBeEnabled();
    expect(screen.queryByTestId('pick-em-submit-hint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pick-em-submit'));

    expect(await screen.findByTestId('pick-em-submitted')).toHaveTextContent('This week counts.');
    expect(submitGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'week-1' },
    }));
    expect(screen.getByTestId('pick-em-status')).toHaveTextContent('Submitted');
    expect(screen.queryByTestId('pick-em-not-submitted-warning')).not.toBeInTheDocument();
  });

  it('ranks a confidence pool\'s picks, swapping the two values in one save when the value chosen is already on another pick', async () => {
    const ranked = week1Games({
      1: { pick: weekPick(NFL_TEAMS.packers, { confidence: 3 }) },
      2: { pick: weekPick(NFL_TEAMS.chiefs, { confidence: 1 }) },
      3: { pick: weekPick(NFL_TEAMS.eagles, { confidence: null }) },
    });
    primeMocks({ week: pickEmWeekFixture({ mode: 'CONFIDENCE', games: ranked }) });
    saveGamePicksMock.mockResolvedValue({ data: pickEmWeekFixture({ mode: 'CONFIDENCE', games: ranked }) });
    renderPickEmEntry();

    expect(await screen.findByTestId('pick-em-submit-hint')).toHaveTextContent('Rank every pick from 1 to 3: 1 still to rank.');
    fireEvent.change(screen.getByTestId('pick-em-game-2-confidence'), { target: { value: '3' } });

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      picks: [
        { sportEventMatchId: 'match-2', sportEventParticipantId: NFL_TEAMS.chiefs.sportEventParticipantId, confidence: 3 },
        { sportEventMatchId: 'match-1', sportEventParticipantId: NFL_TEAMS.packers.sportEventParticipantId, confidence: 1 },
      ],
    });
  });

  it('keeps a pick\'s confidence value when its team is changed in a confidence pool', async () => {
    const ranked = week1Games({ 2: { pick: weekPick(NFL_TEAMS.chiefs, { confidence: 2 }) } });
    primeMocks({ week: pickEmWeekFixture({ mode: 'CONFIDENCE', games: ranked }) });
    saveGamePicksMock.mockResolvedValue({ data: pickEmWeekFixture({ mode: 'CONFIDENCE', games: ranked }) });
    renderPickEmEntry();

    fireEvent.click(await screen.findByTestId(`pick-em-game-2-team-${NFL_TEAMS.bills.sportEventParticipantId}`));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({
      picks: [{ sportEventMatchId: 'match-2', sportEventParticipantId: NFL_TEAMS.bills.sportEventParticipantId, confidence: 2 }],
    });
  });

  it('locks a submitted week\'s games that have kicked off and marks them against the result, while the games still to come can change', async () => {
    const underWay = week1Games({
      1: { pick: weekPick(NFL_TEAMS.packers) },
      2: { locked: true, revealed: true, status: 'COMPLETED', pick: weekPick(NFL_TEAMS.chiefs, { outcome: 'CORRECT', points: 1 }) },
      3: { locked: true, revealed: true, status: 'IN_PROGRESS', pick: weekPick(NFL_TEAMS.eagles) },
    });
    primeMocks({ week: pickEmWeekFixture({ games: underWay, status: 'SUBMITTED', tiebreakerValue: 44, points: 1, maxPossiblePoints: 3 }) });
    renderPickEmEntry();

    const sunday = await screen.findByTestId('pick-em-game-2');
    expect(within(sunday).getByTestId('pick-em-game-2-locked')).toHaveTextContent('Locked');
    expect(within(sunday).getByTestId('pick-em-game-2-outcome')).toHaveTextContent('1 pt');
    expect(within(sunday).queryAllByRole('button')).toHaveLength(0);
    expect(team(2, NFL_TEAMS.chiefs.sportEventParticipantId)).toHaveAttribute('data-picked', 'true');
    expect(within(screen.getByTestId('pick-em-game-1')).getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByTestId('pick-em-points')).toHaveTextContent('1 pt');
    expect(screen.getByTestId('pick-em-submitted')).toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-not-submitted-warning')).not.toBeInTheDocument();
  });

  it('shows each team\'s spread beside it in a pool scored against the spread, "PK" for a pick\'em game, and marks a game on the spread a push', async () => {
    const games = week1Games({
      1: { homeSpread: 0 },
      2: { homeSpread: -3, locked: true, revealed: true, status: 'COMPLETED', pick: weekPick(NFL_TEAMS.chiefs, { outcome: 'PUSH', points: 0 }) },
      3: { homeSpread: 6.5 },
    });
    primeMocks({ week: pickEmWeekFixture({ games, againstTheSpread: true }) });
    renderPickEmEntry();

    await screen.findByTestId('pick-em-games');
    expect(screen.getByTestId(`pick-em-game-2-spread-${NFL_TEAMS.chiefs.sportEventParticipantId}`)).toHaveTextContent('-3');
    expect(screen.getByTestId(`pick-em-game-2-spread-${NFL_TEAMS.bills.sportEventParticipantId}`)).toHaveTextContent('+3');
    expect(screen.getByTestId(`pick-em-game-3-spread-${NFL_TEAMS.cowboys.sportEventParticipantId}`)).toHaveTextContent('-6.5');
    expect(screen.getByTestId(`pick-em-game-1-spread-${NFL_TEAMS.packers.sportEventParticipantId}`)).toHaveTextContent('PK');
    expect(screen.getByTestId('pick-em-game-2-outcome')).toHaveTextContent('Push');
  });

  it('shows no spreads in a pool picked straight up, even when the games have them', async () => {
    primeMocks({ week: pickEmWeekFixture({ games: week1Games({ 2: { homeSpread: -3 } }) }) });
    renderPickEmEntry();

    await screen.findByTestId('pick-em-games');
    expect(screen.queryByTestId(`pick-em-game-2-spread-${NFL_TEAMS.chiefs.sportEventParticipantId}`)).not.toBeInTheDocument();
  });

  it('locks a draft week once its first game kicks off and says it scores nothing, with no picks or submit left to make', async () => {
    const missed = week1Games({ 2: { locked: true, revealed: true, status: 'IN_PROGRESS' } });
    primeMocks({ week: pickEmWeekFixture({ games: missed }) });
    renderPickEmEntry();

    expect(await screen.findByTestId('pick-em-missed-week')).toHaveTextContent('scores nothing');
    expect(within(screen.getByTestId('pick-em-games')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('pick-em-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-tiebreaker-input')).not.toBeInTheDocument();
  });

  it('shows another entry\'s pick on a game from its kickoff, and keeps the picks on games still to come hidden', async () => {
    const othersWeek = week1Games({
      2: { locked: true, revealed: true, status: 'IN_PROGRESS', pick: weekPick(NFL_TEAMS.bills) },
    });
    primeMocks({ week: pickEmWeekFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, status: 'SUBMITTED', games: othersWeek, points: null, maxPossiblePoints: null }) });
    renderPickEmEntry('entry-2');

    await screen.findByTestId('pick-em-games');
    expect(team(2, NFL_TEAMS.bills.sportEventParticipantId)).toHaveAttribute('data-picked', 'true');
    expect(screen.getByTestId('pick-em-game-3-hidden')).toHaveTextContent('This pick is shown at kickoff.');
    expect(screen.getByTestId('pick-em-game-1-hidden')).toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-game-2-hidden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-submit-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-not-submitted-warning')).not.toBeInTheDocument();
  });

  it('switches weeks, reading the chosen week\'s picks, and notes each week\'s status in the switcher', async () => {
    primeMocks();
    renderPickEmEntry();

    const switcher = await screen.findByTestId('pick-em-week-switcher');
    expect(within(switcher).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringMatching(/^Week 1 · .* · Not submitted$/),
      expect.stringMatching(/^Week 2 · .* · Submitted$/),
    ]);
    fireEvent.change(switcher, { target: { value: 'week-2' } });

    await waitFor(() => expect(getGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'week-2' },
    })));
  });

  it('shows the server\'s refusal of a pick in the week\'s own words and reads the week again', async () => {
    primeMocks();
    saveGamePicksMock.mockResolvedValue({ error: { error: { code: 'PREDICTION_GAME_STARTED', message: 'Game started.' } } });
    renderPickEmEntry();

    fireEvent.click(await screen.findByTestId(`pick-em-game-2-team-${NFL_TEAMS.bills.sportEventParticipantId}`));

    expect(await screen.findByTestId('pick-em-pick-error')).toHaveTextContent('That game has kicked off, so its pick is locked.');
    await waitFor(() => expect(getGamePicksMock).toHaveBeenCalledTimes(2));
  });
});

describe('Survivor contest entry page', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      listContestEntriesMock, saveGamePicksMock, submitGamePicksMock,
    ]) {
      mock.mockReset();
    }
  });

  function primeSurvivor(week = survivorWeekFixture()) {
    primeMocks({ week });
    getContestMock.mockResolvedValue({ data: { contest: pickEmContestFixture({ selectionType: 'SURVIVOR' }) } });
  }

  it('asks for one winner, marks a team used in another week and refuses its tap, and shows no tiebreaker or points', async () => {
    primeSurvivor();
    renderPickEmEntry();

    expect(await screen.findByTestId('contest-entry-builder-heading')).toHaveTextContent('Pick a winner');
    const bills = team(2, NFL_TEAMS.bills.sportEventParticipantId);
    expect(bills).toBeDisabled();
    expect(bills).toHaveTextContent('Used');
    expect(team(2, NFL_TEAMS.chiefs.sportEventParticipantId)).toBeEnabled();
    expect(screen.getByTestId('survivor-pick')).toHaveTextContent('None yet');
    expect(screen.getByTestId('pick-em-submit-hint')).toHaveTextContent('Pick one team to submit.');
    expect(screen.queryByTestId('pick-em-tiebreaker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-points')).not.toBeInTheDocument();
    expect(screen.getByTestId('pick-em-not-submitted-warning')).toHaveTextContent('An entry that hasn\'t submitted by then is out.');
  });

  it('saves the tapped team as the week\'s one pick and names it', async () => {
    primeSurvivor();
    saveGamePicksMock.mockResolvedValue({
      data: survivorWeekFixture({ games: week1Games({ 3: { pick: weekPick(NFL_TEAMS.eagles) } }), canSubmit: true }),
    });
    renderPickEmEntry();

    fireEvent.click(await screen.findByTestId(`pick-em-game-3-team-${NFL_TEAMS.eagles.sportEventParticipantId}`));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(savedBody()).toEqual({ picks: [{ sportEventMatchId: 'match-3', sportEventParticipantId: NFL_TEAMS.eagles.sportEventParticipantId }] });
    await waitFor(() => expect(screen.getByTestId('survivor-pick')).toHaveTextContent('Eagles'));
    expect(screen.getByTestId('pick-em-submit')).toBeEnabled();
  });

  it('says an entry that is out went out and offers no pick or submit', async () => {
    primeSurvivor(survivorWeekFixture({ survivor: { eliminatedInWeek: 1, usedParticipantIds: [] }, canSubmit: false }));
    renderPickEmEntry();

    expect(await screen.findByTestId('survivor-eliminated')).toHaveTextContent('This entry went out in week 1, so it picks no more weeks.');
    expect(screen.getByTestId(`pick-em-game-2-team-${NFL_TEAMS.chiefs.sportEventParticipantId}`).tagName).not.toBe('BUTTON');
    expect(screen.queryByTestId('pick-em-submit-panel')).not.toBeInTheDocument();
  });

  it('shows a refused pick of a used team in product copy', async () => {
    primeSurvivor(survivorWeekFixture({ survivor: { eliminatedInWeek: null, usedParticipantIds: [] } }));
    saveGamePicksMock.mockResolvedValue({ error: { error: { code: 'PREDICTION_TEAM_ALREADY_USED', message: 'Team already used.' } } });
    renderPickEmEntry();

    fireEvent.click(await screen.findByTestId(`pick-em-game-2-team-${NFL_TEAMS.chiefs.sportEventParticipantId}`));

    expect(await screen.findByTestId('pick-em-pick-error')).toHaveTextContent('You picked that team in another week or round. Each team can be picked once.');
  });
});

describe('Playoff survivor entry page', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      listContestEntriesMock, saveGamePicksMock, submitGamePicksMock,
    ]) {
      mock.mockReset();
    }
  });

  function primePlayoff(week = playoffSurvivorFixture()) {
    primeMocks({ week });
    getContestMock.mockResolvedValue({ data: { contest: playoffSurvivorContestFixture() } });
  }

  it('opens on the round still to be picked, named as the bracket names it, marks the earlier round\'s team used and warns that the round needs a pick', async () => {
    primePlayoff();
    renderPickEmEntry();

    const switcher = await screen.findByTestId('survivor-round-switcher');
    expect(within(switcher).getAllByRole('option').map((option) => option.textContent)).toEqual(['Conference Championship', 'Super Bowl']);
    expect(switcher).toHaveValue('2');
    const bills = team(2, NFL_TEAMS.bills.sportEventParticipantId);
    expect(bills).toBeDisabled();
    expect(bills).toHaveTextContent('Used');
    expect(team(2, NFL_TEAMS.eagles.sportEventParticipantId)).toBeEnabled();
    expect(screen.queryByTestId('pick-em-game-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('survivor-pick')).toHaveTextContent('None yet');
    expect(screen.getByTestId('survivor-round-needs-pick')).toHaveTextContent('Pick a team before this round\'s first game, or the entry is out.');
  });

  it('shows an earlier round\'s pick, locked, on switching to it', async () => {
    primePlayoff();
    renderPickEmEntry();

    fireEvent.change(await screen.findByTestId('survivor-round-switcher'), { target: { value: '1' } });

    expect(await screen.findByTestId('pick-em-game-1')).toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-game-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('survivor-pick')).toHaveTextContent('Bills');
    expect(screen.getByTestId('contest-entry-builder-heading')).toHaveTextContent('Picks');
  });

  it('says which round put an entry out', async () => {
    primePlayoff(playoffSurvivorFixture({ survivor: { eliminatedInWeek: 1, usedParticipantIds: [] } }));
    renderPickEmEntry();

    expect(await screen.findByTestId('survivor-eliminated'))
      .toHaveTextContent('This entry went out in the Conference Championship, so it picks no more rounds.');
  });
});
