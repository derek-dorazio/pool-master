import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { isAtPlace } from '@poolmaster/shared/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDeviceWidth } from '@/test/device-color-scheme';
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
import { neutralSides } from './test/game-pick-sides';

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
  updateContestEntryMock,
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
    updateContestEntryMock: vi.fn(),
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
  updateContestEntry: updateContestEntryMock,
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
          <Route element={<div data-testid="contest-page" />} path="/league/:leagueCode/contests/:contestId" />
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
  getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'sport-league-1', name: 'NCAA Men' } } });
}

const team = (roundNumber: number, matchNumber: number, sportEventParticipantId: string) =>
  screen.getByTestId(`bracket-game-${roundNumber}-${matchNumber}-team-${sportEventParticipantId}`);

describe('Bracket contest entry page', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getEventMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      getSportLeagueMock, getContestEntryMock, saveGamePicksMock, submitGamePicksMock, updateContestEntryMock,
    ]) {
      mock.mockReset();
    }
  });

  it('ends the screen with one Name and submit card holding the name, the final\'s tiebreaker and Submit bracket, after the picks, and says when to submit by under the name', async () => {
    primeMocks();
    renderBracketEntry();

    const card = await screen.findByTestId('bracket-finish');
    expect(within(card).getByRole('heading', { name: 'Name and submit' })).toBeInTheDocument();
    expect(within(card).getByTestId('contest-entry-name-input')).toHaveValue('Derek’s Bracket');
    expect(within(card).getByLabelText('Tiebreaker · total points in the final')).toBe(screen.getByTestId('bracket-tiebreaker-input'));
    expect(within(card).getByTestId('bracket-submit')).toHaveTextContent('Submit bracket');
    expect(screen.getByTestId('bracket-picks').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('contest-entry-status-line')).toHaveTextContent('Not submitted · submit by the opening tip-off');
    expect(screen.getByTestId('bracket-progress')).toHaveTextContent('Picked0 of 7Points0 ptsMax0 pts');
  });

  it('saves a changed name with Submit bracket, before the submit', async () => {
    const filled = filledBracketGames();
    primeMocks({ gamePicks: gamePicksFixture({ games: filled, tiebreakerValue: 141, canSubmit: true }) });
    updateContestEntryMock.mockResolvedValue({ data: { entry: { id: 'entry-1', name: 'Chalk Talk' } } });
    submitGamePicksMock.mockResolvedValue({ data: gamePicksFixture({ games: filled, tiebreakerValue: 141, status: 'SUBMITTED' }) });
    renderBracketEntry();

    fireEvent.change(await screen.findByTestId('contest-entry-name-input'), { target: { value: 'Chalk Talk' } });
    fireEvent.click(screen.getByTestId('bracket-submit'));

    await waitFor(() => expect(submitGamePicksMock).toHaveBeenCalledTimes(1));
    expect(updateContestEntryMock).toHaveBeenCalledWith(expect.objectContaining({ body: { name: 'Chalk Talk' } }));
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });

  it('draws the whole bracket on a desktop: the first region on the left, the second mirrored on the right and the final where they meet, each round named over its column, and never reads the roster selection room', async () => {
    setDeviceWidth(1280);
    primeMocks();
    renderBracketEntry();

    const board = await screen.findByTestId('bracket-board');
    expect(board).toHaveAttribute('data-layout', 'desktop');
    const east = screen.getByTestId('bracket-region-East');
    expect(within(east).getByTestId('bracket-game-1-1')).toBeInTheDocument();
    expect(within(east).getByTestId('bracket-round-2')).toHaveTextContent('Final Four');
    expect(within(east).getByTestId('bracket-round-1')).toHaveTextContent('Elite Eight');
    expect(within(screen.getByTestId('bracket-region-West')).getByTestId('bracket-game-1-3')).toBeInTheDocument();
    expect(within(screen.getByTestId('bracket-middle')).getByTestId('bracket-game-3-1')).toBeInTheDocument();
    expect(east.compareDocumentPosition(screen.getByTestId('bracket-middle')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getSelectionStateMock).not.toHaveBeenCalled();
  });

  it('offers each first-round game\'s two teams and shows a later side waiting on the earlier round\'s winner until the entry picks it', async () => {
    setDeviceWidth(1280);
    primeMocks();
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(1, 1, TEAMS.duke.sportEventParticipantId)).toHaveTextContent('Duke');
    expect(team(1, 1, TEAMS.vermont.sportEventParticipantId)).toHaveTextContent('Vermont');
    expect(screen.getByTestId('bracket-game-2-1-open-home')).toHaveTextContent('Elite Eight winner');
    expect(screen.getByTestId('bracket-game-3-1-open-away')).toHaveTextContent('Final Four winner');
    expect(screen.getByTestId('bracket-picked-count')).toHaveTextContent('0 of 7');
  });

  it('saves a pick through saveGamePicks and shows the bracket the server answers with, so a later pick the change cleared is shown cleared', async () => {
    // The entry had Duke through round 1's game 1 and round 2's game 1; switching the first to Vermont clears the second.
    const [g1, g2, ...rest] = filledBracketGames();
    primeMocks({ gamePicks: gamePicksFixture({ games: [g1, g2, ...rest] }) });
    const afterSwitch = emptyBracketGames().map((game) => {
      if (isAtPlace(game, { roundNumber: 1, matchNumber: 1 })) {
        return { ...game, pick: gamePick(TEAMS.vermont) };
      }
      if (isAtPlace(game, { roundNumber: 1, matchNumber: 2 })) {
        return { ...game, pick: gamePick(TEAMS.houston) };
      }
      if (isAtPlace(game, { roundNumber: 2, matchNumber: 1 })) {
        return bracketGame({ matchNumber: 1, roundNumber: 2, regionLabel: 'East', sides: neutralSides(null, null, { predictedOne: TEAMS.vermont, predictedTwo: TEAMS.houston }) });
      }
      return game;
    });
    saveGamePicksMock.mockResolvedValue({ data: gamePicksFixture({ games: afterSwitch }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(2, 1, TEAMS.duke.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(team(1, 1, TEAMS.vermont.sportEventParticipantId));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(saveGamePicksMock.mock.calls[0]?.[0]).toMatchObject({
      path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' },
      body: { picks: [{ sportEventRoundMatchId: 'match-1-1', sportEventParticipantId: TEAMS.vermont.sportEventParticipantId }] },
    });
    await waitFor(() => expect(team(1, 1, TEAMS.vermont.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'true'));
    expect(team(2, 1, TEAMS.vermont.sportEventParticipantId)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId(`bracket-game-2-1-team-${TEAMS.duke.sportEventParticipantId}`)).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-picked-count')).toHaveTextContent('2 of 7');
  });

  it('shows the server\'s reason and reads the bracket again when a pick is refused', async () => {
    primeMocks();
    saveGamePicksMock.mockResolvedValue({
      error: { error: { code: 'PREDICTION_GAME_STARTED', message: 'Game 1 has started.' } },
      status: 409,
    });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    fireEvent.click(team(1, 1, TEAMS.duke.sportEventParticipantId));

    expect(await screen.findByTestId('bracket-pick-error')).toHaveTextContent('That game has started, so its pick is locked.');
    await waitFor(() => expect(getGamePicksMock).toHaveBeenCalledTimes(2));
  });

  it('keeps Submit bracket disabled while games are unpicked or the tiebreaker is unsaved, and says which is missing', async () => {
    primeMocks();
    renderBracketEntry();

    await screen.findByTestId('bracket-submit');
    expect(screen.getByTestId('bracket-submit')).toBeDisabled();
    expect(screen.getByTestId('bracket-finish-status')).toHaveTextContent('Pick every game to submit: 7 still to pick.');
  });

  it('saves a typed tiebreaker with no picks when Submit bracket is pressed, then submits the bracket and returns to the contest\'s page', async () => {
    const filled = filledBracketGames();
    primeMocks({ gamePicks: gamePicksFixture({ games: filled }) });
    saveGamePicksMock.mockResolvedValue({ data: gamePicksFixture({ games: filled, tiebreakerValue: 141, canSubmit: true }) });
    submitGamePicksMock.mockResolvedValue({
      data: gamePicksFixture({ games: filled, tiebreakerValue: 141, status: 'SUBMITTED', submittedAt: '2099-03-02T12:00:00.000Z' }),
    });
    renderBracketEntry();

    await screen.findByTestId('bracket-submit');
    expect(screen.getByTestId('bracket-finish-status')).toHaveTextContent('Enter your tiebreaker to submit.');
    expect(screen.getByTestId('bracket-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('bracket-tiebreaker-input'), { target: { value: '141' } });
    expect(screen.getByTestId('bracket-finish-status')).toHaveTextContent('Submit by the opening tip-off');
    fireEvent.click(screen.getByTestId('bracket-submit'));

    await waitFor(() => expect(saveGamePicksMock).toHaveBeenCalledTimes(1));
    expect(saveGamePicksMock.mock.calls[0]?.[0]).toMatchObject({ body: { picks: [], tiebreakerValue: 141 } });

    await waitFor(() => expect(submitGamePicksMock).toHaveBeenCalledTimes(1));
    expect(submitGamePicksMock.mock.calls[0]?.[0]).toMatchObject({ path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' } });
    expect(await screen.findByTestId('contest-page')).toBeInTheDocument();
  });

  it.each([
    ['PREDICTION_WEEK_INCOMPLETE', 'Every game needs a pick before your bracket can be submitted.'],
    ['PREDICTION_TIEBREAKER_MISSING', 'Enter your tiebreaker, the total points of the final, before you submit.'],
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
    fireEvent.click(screen.getByTestId('contest-entry-builder-heading-help'));
    expect(screen.getByTestId('contest-entry-builder-heading-help-callout')).toHaveTextContent(/^Pick the winner of each match\. A later match offers the players you picked/);
    expect(screen.getByTestId('bracket-finish-status')).toHaveTextContent('Pick every match to submit: 7 still to pick.');
    expect(screen.getByLabelText('Tiebreaker · total sets in the final')).toBeInTheDocument();
    expect(screen.getByTestId('bracket-finish')).not.toHaveTextContent(/\bteams?\b|\bgames?\b/);
  });

  it('refuses a tiebreaker above the most the picks read says the server takes, at the field and without saving it', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ games: filledBracketGames(), tiebreakerMax: 250 }) });
    renderBracketEntry();

    fireEvent.change(await screen.findByTestId('bracket-tiebreaker-input'), { target: { value: '251' } });

    expect(screen.getByText('Enter a whole number from 0 to 250.')).toBeInTheDocument();
    expect(screen.getByTestId('bracket-submit')).toBeDisabled();
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });

  it('shows a started bracket read-only, each line marked by the pick that put its team there: right, wrong, or not played yet, with the tiebreaker under the middle', async () => {
    setDeviceWidth(1280);
    const started = filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true }));
    const marked = started.map((game) => {
      if (isAtPlace(game, { roundNumber: 1, matchNumber: 1 })) {
        return { ...game, status: 'COMPLETED' as const, pick: gamePick(TEAMS.duke, { outcome: 'CORRECT', points: 1 }) };
      }
      if (isAtPlace(game, { roundNumber: 1, matchNumber: 2 })) {
        return { ...game, status: 'COMPLETED' as const, pick: gamePick(TEAMS.houston, { outcome: 'BUSTED', points: 0 }) };
      }
      if (isAtPlace(game, { roundNumber: 2, matchNumber: 1 })) {
        return { ...game, sides: neutralSides(TEAMS.duke, TEAMS.texas, { predictedOne: TEAMS.duke, predictedTwo: TEAMS.houston }) };
      }
      return game;
    });
    primeMocks({
      contest: bracketContestFixture({ status: 'ACTIVE' }),
      gamePicks: gamePicksFixture({ games: marked, status: 'SUBMITTED', tiebreakerValue: 141, points: 1, maxPossiblePoints: 9 }),
    });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(2, 1, TEAMS.duke.sportEventParticipantId)).toHaveAttribute('data-mark', 'right');
    const houston = team(2, 1, TEAMS.houston.sportEventParticipantId);
    expect(houston).toHaveAttribute('data-mark', 'wrong');
    expect(houston).toHaveTextContent('Texas');
    expect(team(3, 1, TEAMS.duke.sportEventParticipantId)).toHaveAttribute('data-mark', 'none');
    expect(screen.queryByRole('button', { name: /Duke/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-champion-name')).toHaveTextContent('Duke');
    expect(screen.getByTestId('bracket-points')).toHaveTextContent('1 pt');
    expect(screen.getByTestId('bracket-max-possible')).toHaveTextContent('9 pts');
    expect(screen.queryByTestId('bracket-submit-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-view-tiebreaker')).toHaveTextContent('Tiebreaker: 141 total points in the final.');
  });

  it('keeps another member\'s bracket hidden before the opening tip-off, under its entry name only', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, games: emptyBracketGames(), points: null, maxPossiblePoints: null }) });
    renderBracketEntry('entry-2');

    expect(await screen.findByTestId('bracket-picks-hidden')).toHaveTextContent('This bracket stays hidden until the opening tip-off.');
    expect(screen.getByTestId('contest-entry-header-name')).toHaveTextContent('Chalk All The Way');
    expect(screen.getByTestId('contest-entry-status-line')).toHaveTextContent(/^Hidden until the event starts$/);
    expect(screen.queryByTestId('bracket-board')).not.toBeInTheDocument();
  });

  it('opens another member\'s filled bracket read-only once its games are revealed, its champion named as theirs, not yours', async () => {
    setDeviceWidth(1280);
    const revealed = filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true }));
    primeMocks({
      contest: bracketContestFixture({ status: 'ACTIVE' }),
      gamePicks: gamePicksFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, status: 'SUBMITTED', games: revealed, points: 0, maxPossiblePoints: 11 }),
    });
    renderBracketEntry('entry-2');

    expect(await screen.findByTestId('contest-entry-header-name')).toHaveTextContent('Chalk All The Way');
    expect(screen.getByTestId('contest-entry-status-line')).toHaveTextContent(/^Submitted$/);
    expect(team(3, 1, TEAMS.duke.sportEventParticipantId)).not.toHaveRole('button');
    expect(screen.getByTestId('bracket-champion')).toHaveTextContent('Champion');
    expect(screen.getByTestId('bracket-champion')).not.toHaveTextContent('Your champion');
    expect(screen.queryByTestId('bracket-finish')).not.toBeInTheDocument();
    expect(saveGamePicksMock).not.toHaveBeenCalled();
  });
});

describe('Bracket contest entry page › a second-chance bracket', () => {
  afterEach(() => {
    for (const mock of [
      getContestMock, getEventMock, getGamePicksMock, getLeagueMock, getSelectionStateMock,
      getSportLeagueMock, getContestEntryMock, saveGamePicksMock, submitGamePicksMock, updateContestEntryMock,
    ]) {
      mock.mockReset();
    }
  });

  it('draws a bracket starting at the Elite Eight from that round, by region, with each round named for where it falls in the six', async () => {
    setDeviceWidth(1280);
    primeMocks({ gamePicks: gamePicksFixture({ games: secondChanceBracketGames() }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    const east = screen.getByTestId('bracket-region-East');
    expect(within(east).getByTestId('bracket-round-4')).toHaveTextContent('Elite Eight');
    const middle = screen.getByTestId('bracket-middle');
    expect(within(middle).getAllByTestId('bracket-round-5')[0]).toHaveTextContent('Final Four');
    expect(within(middle).getByTestId('bracket-round-6')).toHaveTextContent('National Championship');
    expect(screen.queryByTestId('bracket-round-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-picked-count')).toHaveTextContent('0 of 7');
  });

  it('offers the starting round\'s decided teams as choices, and has a later side wait on that round\'s winner', async () => {
    setDeviceWidth(1280);
    primeMocks({ gamePicks: gamePicksFixture({ games: secondChanceBracketGames() }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    expect(team(4, 1, TEAMS.duke.sportEventParticipantId)).toHaveRole('button');
    expect(team(4, 1, TEAMS.vermont.sportEventParticipantId)).toHaveRole('button');
    expect(screen.getByTestId('bracket-game-5-1-open-home')).toHaveTextContent('Elite Eight winner');
    expect(screen.getByTestId('bracket-game-6-1-open-home')).toHaveTextContent('Final Four winner');
  });

  it('says the bracket is open, and its picks lock, until the starting round\'s first game rather than the opening tip-off', async () => {
    primeMocks({ gamePicks: gamePicksFixture({ games: secondChanceBracketGames() }) });
    renderBracketEntry();

    await screen.findByTestId('bracket-board');
    fireEvent.click(screen.getByTestId('contest-entry-status'));
    expect(screen.getByTestId('contest-entry-status-contest-phase')).toHaveTextContent('Open until the first game of the Elite Eight');
    expect(screen.getByTestId('contest-entry-status-line')).toHaveTextContent('Not submitted · submit by the first game of the Elite Eight');
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
