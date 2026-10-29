import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import {
  TEAMS,
  bracketContestFixture,
  bracketEntryFixture,
  bracketGame,
  bracketLeagueContextFixture,
  emptyBracketGames,
  filledBracketGames,
  gamePick,
  gamePicksFixture,
  secondChanceBracketGames,
} from './test/bracket-fixtures';

const {
  getContestMock,
  getEventMock,
  getGamePicksMock,
  getLeagueMock,
  getSelectionStateMock,
  getSportLeagueMock,
  getContestEntryMock,
  mockLogger,
  saveGamePicksMock,
  submitGamePicksMock,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getContestMock: vi.fn(),
    getEventMock: vi.fn(),
    getGamePicksMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getSelectionStateMock: vi.fn(),
    getSportLeagueMock: vi.fn(),
    getContestEntryMock: vi.fn(),
    mockLogger: logger,
    saveGamePicksMock: vi.fn(),
    submitGamePicksMock: vi.fn(),
  };
});

bindApiMocks({
  getContest: getContestMock,
  getEvent: getEventMock,
  getGamePicks: getGamePicksMock,
  getLeague: getLeagueMock,
  getSelectionState: getSelectionStateMock,
  getSportLeague: getSportLeagueMock,
  getContestEntry: getContestEntryMock,
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

function renderBracketEntry(entryId = 'entry-1') {
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

function primeMocks({ contest = bracketContestFixture(), gamePicks = gamePicksFixture() } = {}) {
  getContestMock.mockResolvedValue({ data: { contest } });
  getGamePicksMock.mockResolvedValue({ data: gamePicks });
  getContestEntryMock.mockImplementation(({ path }: { path: { entryId: string } }) => Promise.resolve({ data: bracketEntryFixture(path.entryId) }));
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
  getEventMock.mockResolvedValue({ data: { event: { id: 'event-1', sport: 'BASKETBALL', sportLeagueId: 'sport-league-1', startDate: '2099-03-19T16:00:00.000Z' } } });
  getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'sport-league-1', name: 'NCAA Men', roundNames: [] } } });
}

const team = (matchNumber: number, sportEventParticipantId: string) =>
  screen.getByTestId(`bracket-game-${matchNumber}-team-${sportEventParticipantId}`);

describe('Bracket contest entry page', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getEventMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      getSportLeagueMock, getContestEntryMock, saveGamePicksMock, submitGamePicksMock,
    ]) {
      mock.mockReset();
    }
  });

  it('lays a bracket contest\'s games out by round, each region\'s games under its name, with the final where the regions meet last, and never reads the roster selection room', async () => {
    primeMocks();
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    const rounds = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(rounds).toEqual(expect.arrayContaining(['Elite Eight', 'Final Four', 'National Championship']));
    expect(rounds.indexOf('Elite Eight')).toBeLessThan(rounds.indexOf('National Championship'));

    const opening = screen.getByTestId('bracket-round-1');
    expect(within(opening).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(['East', 'West']);
    expect(within(screen.getByTestId('bracket-round-3')).queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    expect(within(screen.getByTestId('bracket-round-3')).getByTestId('bracket-game-7')).toBeInTheDocument();
    expect(getSelectionStateMock).not.toHaveBeenCalled();
  });

  it('offers each first-round game\'s two teams and shows a later side waiting on the earlier round\'s winner until the entry picks it', async () => {
    primeMocks();
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(1, TEAMS.duke.sportEventParticipantId)).toHaveTextContent('Duke');
    expect(team(1, TEAMS.vermont.sportEventParticipantId)).toHaveTextContent('Vermont');
    expect(screen.getByTestId('bracket-game-5-open-home')).toHaveTextContent('Elite Eight winner');
    expect(screen.getByTestId('bracket-game-7-open-away')).toHaveTextContent('Final Four winner');
    expect(screen.getByTestId('bracket-progress')).toHaveTextContent('0 of 7 picked');
  });

  it('saves a pick through saveGamePicks and shows the bracket the server answers with, so a later pick the change cleared is shown cleared', async () => {
    // The entry had Duke through game 1 and game 5; switching game 1 to Vermont clears game 5.
    const [g1, g2, ...rest] = filledBracketGames();
    primeMocks({ gamePicks: gamePicksFixture({ games: [g1, g2, ...rest] }) });
    const afterSwitch = emptyBracketGames().map((game) => {
      if (game.matchNumber === 1) {
        return { ...game, pick: gamePick(TEAMS.vermont) };
      }
      if (game.matchNumber === 2) {
        return { ...game, pick: gamePick(TEAMS.houston) };
      }
      if (game.matchNumber === 5) {
        return bracketGame({ matchNumber: 5, roundNumber: 2, regionLabel: 'East', predictedHome: TEAMS.vermont, predictedAway: TEAMS.houston });
      }
      return game;
    });
    saveGamePicksMock.mockResolvedValue({ data: gamePicksFixture({ games: afterSwitch }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(5, TEAMS.duke.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(team(1, TEAMS.vermont.sportEventParticipantId));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(saveGamePicksMock.mock.calls[0]?.[0]).toMatchObject({
      path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' },
      body: { picks: [{ sportEventMatchId: 'match-1', sportEventParticipantId: TEAMS.vermont.sportEventParticipantId }] },
    });
    await waitFor(() => expect(team(1, TEAMS.vermont.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'true'));
    expect(team(5, TEAMS.vermont.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId(`bracket-game-5-team-${TEAMS.duke.sportEventParticipantId}`)).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-progress')).toHaveTextContent('2 of 7 picked');
  });

  it('shows the server\'s reason and reads the bracket again when a pick is refused', async () => {
    primeMocks();
    saveGamePicksMock.mockResolvedValue({
      error: { error: { code: 'PREDICTION_GAME_STARTED', message: 'Game 1 has started.' } },
      status: 409,
    });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    fireEvent.click(team(1, TEAMS.duke.sportEventParticipantId));

    expect(await screen.findByTestId('bracket-pick-error')).toHaveTextContent('That game has started, so its pick is locked.');
    await waitFor(() => expect(getGamePicksMock).toHaveBeenCalledTimes(2));
  });

  it('keeps Submit bracket disabled while games are unpicked or the tiebreaker is unsaved, and says which is missing', async () => {
    primeMocks();
    renderBracketEntry();

    await screen.findByTestId('bracket-submit');
    expect(screen.getByTestId('bracket-submit')).toBeDisabled();
    expect(screen.getByTestId('bracket-submit-hint')).toHaveTextContent('Pick every game to submit: 7 still to pick.');
  });

  it('saves the tiebreaker on its own with no picks, then submits the bracket once the server allows it and shows it submitted', async () => {
    const filled = filledBracketGames();
    primeMocks({ gamePicks: gamePicksFixture({ games: filled }) });
    saveGamePicksMock.mockResolvedValue({ data: gamePicksFixture({ games: filled, tiebreakerValue: 141, canSubmit: true }) });
    submitGamePicksMock.mockResolvedValue({
      data: gamePicksFixture({ games: filled, tiebreakerValue: 141, status: 'SUBMITTED', submittedAt: '2099-03-02T12:00:00.000Z' }),
    });
    renderBracketEntry();

    await screen.findByTestId('bracket-submit');
    expect(screen.getByTestId('bracket-submit-hint')).toHaveTextContent('Save your tiebreaker to submit.');
    expect(screen.getByTestId('bracket-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('bracket-tiebreaker-input'), { target: { value: '141' } });
    fireEvent.click(screen.getByTestId('bracket-tiebreaker-save'));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(saveGamePicksMock.mock.calls[0]?.[0]).toMatchObject({ body: { picks: [], tiebreakerValue: 141 } });
    expect(await screen.findByTestId('bracket-tiebreaker-saved')).toHaveTextContent('Saved tiebreaker: 141 total points.');
    await waitFor(() => expect(screen.getByTestId('bracket-submit')).toBeEnabled());

    fireEvent.click(screen.getByTestId('bracket-submit'));

    await waitFor(() => expect(submitGamePicksMock).toHaveBeenCalledTimes(1));
    expect(submitGamePicksMock.mock.calls[0]?.[0]).toMatchObject({ path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' } });
    expect(await screen.findByTestId('bracket-submitted')).toBeInTheDocument();
    expect(screen.getByTestId('bracket-status')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('contest-entry-status')).toHaveAccessibleName('Entry status: Submitted');
  });

  it.each([
    ['PREDICTION_WEEK_INCOMPLETE', 'Every game needs a pick before your bracket can be submitted.'],
    ['PREDICTION_TIEBREAKER_MISSING', 'Save your tiebreaker, the total points of the final, before you submit.'],
  ])('explains a submit refused with 409 %s in plain words', async (code, message) => {
    const filled = filledBracketGames();
    primeMocks({ gamePicks: gamePicksFixture({ games: filled, tiebreakerValue: 141, canSubmit: true }) });
    submitGamePicksMock.mockResolvedValue({ error: { error: { code, message: 'Refused.' } }, status: 409 });
    renderBracketEntry();

    fireEvent.click(await screen.findByTestId('bracket-submit'));

    expect(await screen.findByTestId('bracket-submit-error')).toHaveTextContent(message);
  });

  // #704: a tennis draw's bracket reads players, matches and sets, never teams, games or points.
  it('words a tennis bracket in its sport\'s own nouns: players and matches to pick, and the final\'s total sets as the tiebreaker', async () => {
    primeMocks({ contest: bracketContestFixture({ sport: 'TENNIS' }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-submit');
    expect(screen.getByText(/^Pick the winner of each match\. A later match offers the players you picked/)).toBeInTheDocument();
    expect(screen.getByTestId('bracket-submit-hint')).toHaveTextContent('Pick every match to submit: 7 still to pick.');
    expect(screen.getByText('Total sets in the final, both players together. It only breaks a tie on points.')).toBeInTheDocument();
    expect(screen.getByTestId('bracket-submit-panel')).not.toHaveTextContent(/\bteams?\b|\bgames?\b/);
  });

  it('refuses a tiebreaker outside 0 to 999 at the field without saving it', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ games: filledBracketGames() }) });
    renderBracketEntry();

    fireEvent.change(await screen.findByTestId('bracket-tiebreaker-input'), { target: { value: '1000' } });

    expect(screen.getByText('Enter a whole number from 0 to 999.')).toBeInTheDocument();
    expect(screen.getByTestId('bracket-tiebreaker-save')).toBeDisabled();
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });

  it('shows a started bracket read-only, each pick marked correct with its points, busted or pending, with the entry\'s points and max possible', async () => {
    const started = filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true }));
    const marked = started.map((game) => {
      switch (game.matchNumber) {
        case 1:
          return { ...game, status: 'COMPLETED' as const, pick: gamePick(TEAMS.duke, { outcome: 'CORRECT', points: 1 }) };
        case 2:
          return { ...game, status: 'COMPLETED' as const, pick: gamePick(TEAMS.houston, { outcome: 'BUSTED', points: 0 }) };
        default:
          return game;
      }
    });
    primeMocks({
      contest: bracketContestFixture({ status: 'ACTIVE' }),
      gamePicks: gamePicksFixture({ games: marked, status: 'SUBMITTED', tiebreakerValue: 141, points: 1, maxPossiblePoints: 9 }),
    });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(screen.getByTestId('bracket-game-1-outcome')).toHaveTextContent('Correct · 1 pt');
    expect(screen.getByTestId('bracket-game-2-outcome')).toHaveTextContent('Busted');
    expect(screen.getByTestId('bracket-game-7-outcome')).toHaveTextContent('Pending');
    expect(team(1, TEAMS.duke.sportEventParticipantId)).toHaveAttribute('data-picked', 'true');
    expect(screen.queryByRole('button', { name: /Duke/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-points')).toHaveTextContent('1 pt');
    expect(screen.getByTestId('bracket-max-possible')).toHaveTextContent('9 pts');
    expect(screen.queryByTestId('bracket-submit-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-tiebreaker-summary')).toHaveTextContent('Tiebreaker: 141 total points in the final.');
  });

  it('keeps another member\'s bracket hidden before the opening tip-off, under its group\'s name', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, games: emptyBracketGames(), points: null, maxPossiblePoints: null }) });
    renderBracketEntry('entry-2');

    expect(await screen.findByTestId('bracket-picks-hidden')).toHaveTextContent('This bracket stays hidden until the opening tip-off.');
    expect(screen.getByTestId('contest-entry-summary')).toHaveTextContent('Derek’s Great Golf Guys');
    expect(screen.queryByTestId('bracket-board')).not.toBeInTheDocument();
  });

  it('opens another member\'s filled bracket read-only once its games are revealed', async () => {
    const revealed = filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true }));
    primeMocks({
      contest: bracketContestFixture({ status: 'ACTIVE' }),
      gamePicks: gamePicksFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, status: 'SUBMITTED', games: revealed, points: 0, maxPossiblePoints: 11 }),
    });
    renderBracketEntry('entry-2');

    expect(await screen.findByTestId('contest-entry-heading')).toHaveTextContent('Chalk All The Way');
    expect(screen.getByTestId('contest-entry-summary')).toHaveTextContent('Derek’s Great Golf Guys');
    expect(team(7, TEAMS.duke.sportEventParticipantId)).toHaveAttribute('data-picked', 'true');
    expect(screen.queryByTestId('bracket-submit-panel')).not.toBeInTheDocument();
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });
});

describe('Bracket contest entry page › a second-chance bracket', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getEventMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      getSportLeagueMock, getContestEntryMock, saveGamePicksMock, submitGamePicksMock,
    ]) {
      mock.mockReset();
    }
  });

  it('lays out a bracket starting at the Elite Eight from that round, by region, with each round named for where it falls in the six', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ games: secondChanceBracketGames() }) });
    renderBracketEntry();

    const board = await screen.findByTestId('bracket-board');
    expect(within(board).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['Elite Eight', 'Final Four', 'National Championship']);
    const opening = screen.getByTestId('bracket-round-4');
    expect(within(opening).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(['East', 'West']);
    expect(screen.queryByTestId('bracket-round-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-picked-count')).toHaveTextContent('0 of 7 picked');
  });

  it('offers the starting round\'s decided teams as choices, and has a later side wait on that round\'s winner', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ games: secondChanceBracketGames() }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(57, TEAMS.duke.sportEventParticipantId)).toHaveRole('button');
    expect(team(57, TEAMS.vermont.sportEventParticipantId)).toHaveRole('button');
    expect(screen.getByTestId('bracket-game-61-open-home')).toHaveTextContent('Elite Eight winner');
    expect(screen.getByTestId('bracket-game-63-open-home')).toHaveTextContent('Final Four winner');
  });

  it('says the bracket is open, and its picks lock, until the starting round\'s first game rather than the opening tip-off', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ games: secondChanceBracketGames() }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    fireEvent.click(screen.getByTestId('contest-entry-status'));
    expect(screen.getByTestId('contest-entry-status-contest-phase')).toHaveTextContent('Open until the first game of the Elite Eight');
    expect(screen.getByText('Picks lock at the first game of the Elite Eight.')).toBeInTheDocument();
    expect(screen.queryByText(/opening tip-off/)).not.toBeInTheDocument();
  });

  it('keeps another member\'s second-chance bracket hidden until the starting round\'s first game', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ entryId: 'entry-2', ownEntry: false, games: secondChanceBracketGames(), points: null, maxPossiblePoints: null }) });
    renderBracketEntry('entry-2');

    expect(await screen.findByTestId('bracket-picks-hidden'))
      .toHaveTextContent('This bracket stays hidden until the first game of the Elite Eight.');
    expect(screen.getByTestId('contest-entry-status')).toHaveAccessibleName('Entry status: Hidden until the event starts');
  });
});
