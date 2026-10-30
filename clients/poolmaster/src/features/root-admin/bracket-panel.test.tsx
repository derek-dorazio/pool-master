import { MatchEnding } from '@poolmaster/shared/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventDto, SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventResultsPage } from './root-admin-sport-event-results-page';
import { affiliationFixture, fieldEntryFixture, participantFixture, sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';

// MSW hands path parameters over as strings, so a match number reads '1'.
// #698, #700: a basketball tournament's results page shows its bracket round by round, chosen by
// the head-to-head family's entry in the admin results registry. Before release an admin edits
// pairings and marks play-in places; once released one tap names each game's winner.

const {
  getEventMock,
  getEventBracketMock,
  listEventParticipantsMock,
  recordEventMatchResultMock,
  clearEventMatchResultMock,
  recordEventMatchPeriodScoreMock,
  clearEventMatchPeriodScoreMock,
  cancelEventMatchMock,
  updateEventBracketMatchMock,
  updateEventParticipantsMock,
  setEventPlayInWinnerMock,
  replaceEventParticipantMock,
  listSportsMock,
  listParticipantsMock,
  listSportLeaguesMock,
  listParticipantLeagueAffiliationsMock,
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
    getEventMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    recordEventMatchResultMock: vi.fn(),
    clearEventMatchResultMock: vi.fn(),
    recordEventMatchPeriodScoreMock: vi.fn(),
    clearEventMatchPeriodScoreMock: vi.fn(),
    cancelEventMatchMock: vi.fn(),
    updateEventBracketMatchMock: vi.fn(),
    updateEventParticipantsMock: vi.fn(),
    setEventPlayInWinnerMock: vi.fn(),
    replaceEventParticipantMock: vi.fn(),
    listSportsMock: vi.fn(),
    listParticipantsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listParticipantLeagueAffiliationsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  getEventBracket: getEventBracketMock,
  listEventParticipants: listEventParticipantsMock,
  recordEventMatchResult: recordEventMatchResultMock,
  clearEventMatchResult: clearEventMatchResultMock,
  recordEventMatchPeriodScore: recordEventMatchPeriodScoreMock,
  clearEventMatchPeriodScore: clearEventMatchPeriodScoreMock,
  cancelEventMatch: cancelEventMatchMock,
  updateEventBracketMatch: updateEventBracketMatchMock,
  updateEventParticipants: updateEventParticipantsMock,
  setEventPlayInWinner: setEventPlayInWinnerMock,
  replaceEventParticipant: replaceEventParticipantMock,
  listSports: listSportsMock,
  listParticipants: listParticipantsMock,
  listSportLeagues: listSportLeaguesMock,
  listParticipantLeagueAffiliations: listParticipantLeagueAffiliationsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const tournament = sportEventFixture({
  id: 'evt-1',
  sport: 'BASKETBALL',
  name: 'Harbour Classic',
  status: 'SCHEDULED',
  rounds: 2,
  roundsPar: null,
  allowedTransitions: [],
});

const duke = fieldEntryFixture({ id: 'sep-1', participantId: 'p-1', seedNumber: 1, participant: participantFixture({ id: 'p-1', name: 'Duke' }) });
const vermont = fieldEntryFixture({ id: 'sep-2', participantId: 'p-2', seedNumber: 16, participant: participantFixture({ id: 'p-2', name: 'Vermont' }) });
const houston = fieldEntryFixture({ id: 'sep-3', participantId: 'p-3', seedNumber: 2, participant: participantFixture({ id: 'p-3', name: 'Houston' }) });
const texas = fieldEntryFixture({ id: 'sep-4', participantId: 'p-4', seedNumber: 15, participant: participantFixture({ id: 'p-4', name: 'Texas' }) });

function match(overrides: Partial<SportEventMatchDto> & Pick<SportEventMatchDto, 'id' | 'matchNumber' | 'roundNumber'>): SportEventMatchDto {
  return {
    sportEventId: 'evt-1',
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
    isNeutralSite: true,
    scheduledDate: null,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: MatchEnding.PLAYED,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

function seed(matches: SportEventMatchDto[], options: { event?: SportEventDto; field?: SportEventParticipantDto[]; roundNames?: string[]; matchPeriodLayout?: 'HALVES' } = {}) {
  getEventMock.mockResolvedValue({ data: { event: options.event ?? tournament } });
  listSportLeaguesMock.mockResolvedValue({
    data: { sportLeagues: [sportLeagueFixture({ id: tournament.sportLeagueId, name: 'NCAA Division I Men', roundNames: options.roundNames ?? [], matchPeriodLayout: options.matchPeriodLayout ?? null })] },
  });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: options.field ?? [duke, vermont, houston, texas] } });
  // No roster: every active team of the sport may be named.
  listParticipantLeagueAffiliationsMock.mockResolvedValue({ data: { affiliations: [] } });
  getEventBracketMock.mockResolvedValue({ data: { matches } });
}

/** The tournament's league roster: once it has one, only its teams replace or win a place (#830). */
function rosterOf(...participants: ReturnType<typeof participantFixture>[]) {
  listParticipantLeagueAffiliationsMock.mockResolvedValue({
    data: { affiliations: participants.map((participant) => affiliationFixture({ sportLeagueId: tournament.sportLeagueId, participantId: participant.id, participant })) },
  });
}


function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/basketball/events/evt-1/results']}>
        <Routes>
          <Route element={<RootAdminSportEventResultsPage />} path="/manage/sports/:sport/events/:eventId/results" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSportEventResultsPage for a basketball tournament', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('says the bracket is not loaded yet when the tournament has no matches', async () => {
    seed([]);
    renderPage();

    expect(await screen.findByTestId('root-admin-bracket-empty')).toHaveTextContent(
      'No bracket yet. Its games are loaded before the tournament is released.',
    );
  });

  it('lists each round under its name, with seeded pairings and the earlier match that fills an open side', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME', status: 'COMPLETED', winnerSide: 'HOME', homeScore: 80, awayScore: 61 }),
      match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4', isNeutralSite: false, advancesToMatchId: 'm-3', advancesToSide: 'AWAY' }),
      match({ id: 'm-3', matchNumber: 3, roundNumber: 2 }),
    ]);
    renderPage();

    const firstRound = await screen.findByTestId('root-admin-bracket-round-1');
    expect(within(firstRound).getByRole('heading')).toHaveTextContent('Final Four');
    expect(within(firstRound).getByRole('columnheader', { name: 'Game' })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-bracket-pairing-1')).toHaveTextContent('(1) Duke vs (16) Vermont');
    expect(screen.getByTestId('root-admin-bracket-pairing-2')).toHaveTextContent('(15) Texas @ (2) Houston');
    expect(within(screen.getByTestId('root-admin-bracket-match-1')).getByText('Final')).toBeInTheDocument();

    const final = screen.getByTestId('root-admin-bracket-round-2');
    expect(within(final).getByRole('heading')).toHaveTextContent('National Championship');
    expect(screen.getByTestId('root-admin-bracket-pairing-3')).toHaveTextContent('Winner of game 1 vs Winner of game 2');
    expect(within(screen.getByTestId('root-admin-bracket-match-3')).getByText('To be announced')).toBeInTheDocument();
  });

  it('names each round by the sport league\'s own round names when it has them, the NBA\'s last two for a two-round bracket', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME' }),
      match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4', advancesToMatchId: 'm-3', advancesToSide: 'AWAY' }),
      match({ id: 'm-3', matchNumber: 3, roundNumber: 2 }),
    ], { roundNames: ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'] });
    renderPage();

    await waitFor(() => expect(within(screen.getByTestId('root-admin-bracket-round-1')).getByRole('heading')).toHaveTextContent('Conference Finals'));
    expect(within(screen.getByTestId('root-admin-bracket-round-2')).getByRole('heading')).toHaveTextContent('NBA Finals');
  });

  it('records the tapped team as a game\'s winner, with no scores, and reloads the bracket', async () => {
    seed([match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2' })]);
    recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-bracket-winner-1-AWAY'));

    expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1', matchNumber: '1' },
      body: { winnerSide: 'AWAY', homeScore: null, awayScore: null },
    }));
    await waitFor(() => expect(getEventBracketMock).toHaveBeenCalledTimes(2));
  });

  it('marks a decided game\'s winner as chosen and clears the result on request', async () => {
    seed([match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', status: 'COMPLETED', winnerSide: 'HOME' })]);
    clearEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
    renderPage();

    const winner = await screen.findByTestId('root-admin-bracket-winner-1-HOME');
    expect(winner).toHaveTextContent('Duke won');
    expect(winner).toHaveAttribute('aria-pressed', 'true');
    expect(winner).toBeDisabled();
    expect(screen.getByTestId('root-admin-bracket-winner-1-AWAY')).toHaveTextContent('Vermont wins');

    await userEvent.click(screen.getByTestId('root-admin-bracket-clear-1'));
    expect(clearEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'evt-1', matchNumber: '1' } }));
  });

  it('saves a game that ended early, from under "Ended early", as its ending and winner with no score', async () => {
    seed([match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2' })]);
    recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
    renderPage();

    expect(screen.queryByTestId('root-admin-bracket-early-1-editor')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('root-admin-bracket-early-1'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-bracket-early-1-ending'), 'WALKOVER');
    await userEvent.selectOptions(screen.getByTestId('root-admin-bracket-early-1-winner'), 'AWAY');
    await userEvent.click(screen.getByTestId('root-admin-bracket-early-1-save'));

    expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1', matchNumber: '1' },
      body: { winnerSide: 'AWAY', homeScore: null, awayScore: null, ending: 'WALKOVER' },
    }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-bracket-early-1-editor')).not.toBeInTheDocument());
  });

  it('marks the winner of a game that ended early with how it ended: "ret." and "w/o"', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', status: 'COMPLETED', winnerSide: 'HOME', ending: MatchEnding.RETIREMENT }),
      match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4', status: 'COMPLETED', winnerSide: 'AWAY', ending: MatchEnding.WALKOVER }),
    ]);
    renderPage();

    expect(await screen.findByTestId('root-admin-bracket-winner-1-HOME')).toHaveTextContent('Duke won (ret.)');
    expect(screen.getByTestId('root-admin-bracket-winner-2-AWAY')).toHaveTextContent('Texas won (w/o)');
  });

  it('explains in product copy that a winner who already played the next game must have that result cleared first', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME', status: 'COMPLETED', winnerSide: 'HOME' }),
      match({ id: 'm-3', matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-3', status: 'COMPLETED', winnerSide: 'HOME' }),
    ]);
    recordEventMatchResultMock.mockResolvedValue({ error: { error: { code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', message: 'Match 1 winner already played match 3.' } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-bracket-winner-1-AWAY'));

    expect(await screen.findByTestId('root-admin-bracket-error-1')).toHaveTextContent(
      "This game's winner is already in game 3, which has a score. Clear game 3's score first.",
    );
  });

  it('offers no winner buttons until both teams of a game are known', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME' }),
      match({ id: 'm-3', matchNumber: 3, roundNumber: 2, awaySportEventParticipantId: 'sep-3' }),
    ]);
    renderPage();

    const final = await screen.findByTestId('root-admin-bracket-match-3');
    expect(within(final).getByText('Waiting on both teams')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-bracket-winner-3-HOME')).not.toBeInTheDocument();
  });

  // #715: a week's games link nowhere and share one round; a postponed one is cancelled.
  describe('a week of games that form no bracket', () => {
    const week = [
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', isNeutralSite: false }),
      match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4', isNeutralSite: false }),
    ];

    it('cancels an unplayed game after the admin confirms, and reloads the games', async () => {
      seed(week);
      cancelEventMatchMock.mockResolvedValue({ data: { matches: [] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-cancel-2'));
      expect(screen.getByText(/^\(15\) Texas @ \(2\) Houston will count for nothing in every contest\. If it is played later, add it to the week it moves to before that week is released\.$/)).toBeInTheDocument();
      expect(cancelEventMatchMock).not.toHaveBeenCalled();
      await userEvent.click(screen.getByTestId('root-admin-bracket-cancel-confirm-2'));

      expect(cancelEventMatchMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'evt-1', matchNumber: '2' } }));
      await waitFor(() => expect(getEventBracketMock).toHaveBeenCalledTimes(2));
    });

    it('explains in product copy that a game with a result is cleared before it is cancelled', async () => {
      seed(week);
      cancelEventMatchMock.mockResolvedValue({ error: { error: { code: 'MATCH_ALREADY_PLAYED', message: 'Match 1 has a result.' } } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-cancel-1'));
      await userEvent.click(screen.getByTestId('root-admin-bracket-cancel-confirm-1'));

      expect(await screen.findByTestId('root-admin-bracket-cancel-error-1')).toHaveTextContent('This game has a result. Clear it before cancelling the game.');
    });

    it('offers no cancel for a played or cancelled game, a draft week, or a game of a bracket', async () => {
      seed([{ ...week[0], status: 'COMPLETED', winnerSide: 'HOME' }, { ...week[1], status: 'CANCELLED' }]);
      const { unmount: unmountPlayed } = renderPage();
      expect(await screen.findByTestId('root-admin-bracket-winner-1-HOME')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-cancel-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-cancel-2')).not.toBeInTheDocument();
      unmountPlayed();

      seed(week, { event: { ...tournament, status: 'DRAFT' } });
      const { unmount: unmountDraft } = renderPage();
      expect(await screen.findByTestId('root-admin-bracket-edit-1')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-cancel-1')).not.toBeInTheDocument();
      unmountDraft();

      seed([
        { ...week[0], advancesToMatchId: 'm-3', advancesToSide: 'HOME' },
        match({ id: 'm-3', matchNumber: 3, roundNumber: 2, awaySportEventParticipantId: 'sep-3' }),
      ]);
      renderPage();
      expect(await screen.findByTestId('root-admin-bracket-winner-1-HOME')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-cancel-1')).not.toBeInTheDocument();
    });

    // #792: a game of a week can end level; a tie is saved with each side's score.
    it('saves a tie on a week game with the score each side reached, and shows a saved tie', async () => {
      seed(week);
      recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
      const { unmount } = renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-tie-1'));
      expect(screen.getByTestId('root-admin-bracket-tie-1-save')).toBeDisabled();
      await userEvent.type(screen.getByTestId('root-admin-bracket-tie-1-score'), '17');
      await userEvent.click(screen.getByTestId('root-admin-bracket-tie-1-save'));
      expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', matchNumber: '1' },
        body: { winnerSide: null, homeScore: 17, awayScore: 17 },
      }));
      unmount();

      seed([{ ...week[0], status: 'COMPLETED', winnerSide: null, homeScore: 17, awayScore: 17 }, week[1]]);
      renderPage();
      expect(await screen.findByTestId('root-admin-bracket-tie-1')).toHaveTextContent('Tie 17-17');
      expect(screen.getByTestId('root-admin-bracket-tie-1')).toBeDisabled();
      expect(screen.getByTestId('root-admin-bracket-clear-1')).toBeInTheDocument();
    });

    it('offers no tie on a game of a bracket', async () => {
      seed([
        { ...week[0], advancesToMatchId: 'm-3', advancesToSide: 'HOME' },
        match({ id: 'm-3', matchNumber: 3, roundNumber: 2, awaySportEventParticipantId: 'sep-3' }),
      ]);
      renderPage();
      expect(await screen.findByTestId('root-admin-bracket-winner-1-HOME')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-tie-1')).not.toBeInTheDocument();
    });

    // #720: a pool scored against the spread reads each game's spread from the home side.
    it('shows each game\'s spread from the home team\'s side, and no spread column for a bracket', async () => {
      seed([{ ...week[0], homeSpread: -3.5 }, week[1]]);
      const { unmount } = renderPage();
      expect(await screen.findByTestId('root-admin-bracket-spread-1')).toHaveTextContent('Duke -3.5');
      expect(screen.getByTestId('root-admin-bracket-spread-2')).toHaveTextContent('No spread');
      unmount();

      seed([
        { ...week[0], advancesToMatchId: 'm-3', advancesToSide: 'HOME' },
        match({ id: 'm-3', matchNumber: 3, roundNumber: 2, awaySportEventParticipantId: 'sep-3' }),
      ]);
      renderPage();
      expect(await screen.findByTestId('root-admin-bracket-winner-1-HOME')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-spread-1')).not.toBeInTheDocument();
    });

    it('saves a game\'s spread and reloads the games', async () => {
      seed(week);
      updateEventBracketMatchMock.mockResolvedValue({ data: { match: { ...week[1], homeSpread: 7 } } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-spread-edit-2'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-spread-input-2'), '7');
      await userEvent.click(screen.getByTestId('root-admin-bracket-spread-save-2'));
      expect(updateEventBracketMatchMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', matchNumber: '2' },
        body: { homeSpread: 7 },
      }));
      await waitFor(() => expect(getEventBracketMock).toHaveBeenCalledTimes(2));
    });

    it('clears a draft game\'s spread when the box is left empty', async () => {
      seed([{ ...week[0], homeSpread: -3.5 }, week[1]], { event: { ...tournament, status: 'DRAFT' } });
      updateEventBracketMatchMock.mockResolvedValue({ data: { match: week[0] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-spread-edit-1'));
      await userEvent.clear(screen.getByTestId('root-admin-bracket-spread-input-1'));
      await userEvent.click(screen.getByTestId('root-admin-bracket-spread-save-1'));
      expect(updateEventBracketMatchMock).toHaveBeenCalledWith(expect.objectContaining({ body: { homeSpread: null } }));
    });

    it('refuses clearing a released game\'s spread before sending it', async () => {
      seed([{ ...week[0], homeSpread: -3.5 }, week[1]]);
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-spread-edit-1'));
      await userEvent.clear(screen.getByTestId('root-admin-bracket-spread-input-1'));

      expect(screen.getByTestId('root-admin-bracket-spread-save-1')).toBeDisabled();
      expect(screen.getByText('The tournament has been released, so this spread can be changed but not cleared.')).toBeInTheDocument();
      expect(updateEventBracketMatchMock).not.toHaveBeenCalled();
    });

    it('refuses a spread that is not in half points before sending it', async () => {
      seed(week);
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-spread-edit-1'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-spread-input-1'), '3.25');

      expect(screen.getByTestId('root-admin-bracket-spread-save-1')).toBeDisabled();
      expect(screen.getByText('Enter a spread in half points, such as -3.5 or 7, between -99.5 and 99.5.')).toBeInTheDocument();
    });

    it('explains in product copy that a game with picks keeps its spread', async () => {
      seed(week);
      updateEventBracketMatchMock.mockResolvedValue({ error: { error: { code: 'MATCH_SPREAD_LOCKED', message: 'Match 1 already has picks.' } } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-spread-edit-1'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-spread-input-1'), '-3');
      await userEvent.click(screen.getByTestId('root-admin-bracket-spread-save-1'));

      expect(await screen.findByTestId('root-admin-bracket-spread-error-1')).toHaveTextContent('This game already has picks, so its spread can no longer change.');
    });

    it('offers no spread change on a cancelled game, leaving the server to refuse a game with picks', async () => {
      seed([{ ...week[0], status: 'COMPLETED', winnerSide: 'HOME', homeSpread: -3.5 }, { ...week[1], status: 'CANCELLED' }]);
      renderPage();
      expect(await screen.findByTestId('root-admin-bracket-spread-1')).toHaveTextContent('Duke -3.5');
      expect(screen.getByTestId('root-admin-bracket-spread-edit-1')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-spread-edit-2')).not.toBeInTheDocument();
    });
  });

  // #772: American football keeps the score at the end of each quarter but the last; the final
  // score, overtime included, is the game's result.
  describe('quarter scores for an American football game', () => {
    const playoffs = sportEventFixture({ id: 'evt-1', sport: 'AMERICAN_FOOTBALL', name: 'NFL Playoffs', status: 'IN_PROGRESS', rounds: 1, roundsPar: null, allowedTransitions: [] });
    const superBowl = (overrides: Partial<SportEventMatchDto> = {}) => match({
      id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', ...overrides,
    });

    it('shows the score at the end of the first three quarters and the final score, away side first, and "Not entered" for the rest', async () => {
      seed([superBowl({ periodScores: [{ periodNumber: 1, homeScore: 0, awayScore: 3 }], status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 13, awayScore: 29 })], { event: playoffs });
      renderPage();

      expect(await screen.findByTestId('root-admin-bracket-score-1-1')).toHaveTextContent('End of quarter 1');
      expect(screen.getByTestId('root-admin-bracket-score-1-1-value')).toHaveTextContent('Vermont 3, Duke 0');
      expect(screen.getByTestId('root-admin-bracket-score-1-2-value')).toHaveTextContent('Not entered');
      expect(screen.getByTestId('root-admin-bracket-score-1-3-value')).toHaveTextContent('Not entered');
      expect(screen.queryByTestId('root-admin-bracket-score-1-4')).not.toBeInTheDocument();
      expect(screen.getByTestId('root-admin-bracket-score-1-final-value')).toHaveTextContent('Vermont 29, Duke 13');
    });

    it('marks the final score of a game that ended early, and a walkover\'s missing score, with how it ended', async () => {
      seed([superBowl({ status: 'COMPLETED', winnerSide: 'HOME', homeScore: 10, awayScore: 14, ending: MatchEnding.DEFAULT })], { event: playoffs });
      renderPage();

      expect(await screen.findByTestId('root-admin-bracket-score-1-final-value')).toHaveTextContent('Vermont 14, Duke 10 def.');
    });

    it('says a walkover has its winner entered and no score, marked "w/o"', async () => {
      seed([superBowl({ status: 'COMPLETED', winnerSide: 'AWAY', ending: MatchEnding.WALKOVER })], { event: playoffs });
      renderPage();

      expect(await screen.findByTestId('root-admin-bracket-score-1-final-value')).toHaveTextContent('Winner entered, no score (w/o)');
    });

    it('says a game finished with its winner alone has a winner entered but no final score', async () => {
      seed([superBowl({ status: 'COMPLETED', winnerSide: 'AWAY' })], { event: playoffs });
      renderPage();

      expect(await screen.findByTestId('root-admin-bracket-score-1-final-value')).toHaveTextContent('Winner entered, no score');
    });

    it('saves a quarter\'s score and clears one on request, reloading the games', async () => {
      seed([superBowl({ periodScores: [{ periodNumber: 1, homeScore: 0, awayScore: 3 }] })], { event: playoffs });
      recordEventMatchPeriodScoreMock.mockResolvedValue({ data: { matches: [] } });
      clearEventMatchPeriodScoreMock.mockResolvedValue({ data: { matches: [] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-score-1-2-edit'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-2-away'), '9');
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-2-home'), '0');
      await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-2-save'));
      expect(recordEventMatchPeriodScoreMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', matchNumber: '1', periodNumber: '2' },
        body: { homeScore: 0, awayScore: 9 },
      }));

      await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-1-clear'));
      expect(clearEventMatchPeriodScoreMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'evt-1', matchNumber: '1', periodNumber: '1' } }));
      await waitFor(() => expect(getEventBracketMock).toHaveBeenCalledTimes(3));
    });

    it('saves the final score as the game\'s result, the higher score winning, and refuses a tie in a bracket before sending it', async () => {
      const conferenceFinal = match({ id: 'm-2', matchNumber: 2, roundNumber: 1, advancesToMatchId: 'm-1', advancesToSide: 'AWAY' });
      seed([superBowl({ roundNumber: 2 }), conferenceFinal], { event: playoffs });
      recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-score-1-final-edit'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-away'), '13');
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-home'), '13');
      expect(screen.getByText('The final score can\'t be a tie: the winner\'s score is the higher.')).toBeInTheDocument();
      expect(screen.getByTestId('root-admin-bracket-score-1-final-save')).toBeDisabled();

      await userEvent.clear(screen.getByTestId('root-admin-bracket-score-1-final-away'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-away'), '29');
      await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-final-save'));
      expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', matchNumber: '1' },
        body: { winnerSide: 'AWAY', homeScore: 13, awayScore: 29, ending: 'PLAYED' },
      }));
    });

    // #792: a game of a week can end level, so its level final score is saved as a tie.
    it('saves a level final score of a week game as a tie with no winner', async () => {
      seed([superBowl(), match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4' })], { event: playoffs });
      recordEventMatchResultMock.mockResolvedValue({ data: { matches: [] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-score-1-final-edit'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-away'), '20');
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-final-home'), '20');
      expect(screen.queryByText('The final score can\'t be a tie: the winner\'s score is the higher.')).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-final-save'));
      expect(recordEventMatchResultMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', matchNumber: '1' },
        body: { winnerSide: null, homeScore: 20, awayScore: 20, ending: 'PLAYED' },
      }));
    });

    it('explains in product copy a quarter\'s score that is out of step with the game\'s other scores', async () => {
      seed([superBowl()], { event: playoffs });
      recordEventMatchPeriodScoreMock.mockResolvedValue({ error: { error: { code: 'MATCH_PERIOD_SCORE_INVALID', message: 'out of step' } }, response: { status: 422 } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-score-1-3-edit'));
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-3-away'), '1');
      await userEvent.type(screen.getByTestId('root-admin-bracket-score-1-3-home'), '0');
      await userEvent.click(screen.getByTestId('root-admin-bracket-score-1-3-save'));

      expect(await screen.findByTestId('root-admin-bracket-score-1-3-error')).toHaveTextContent('A score can only go up as the game goes on. Check it against the other scores of this game.');
    });

    it('scores a game of a sport league played in halves by its first half and its final, and offers no scores for a draft', async () => {
      const collegeFinal = match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2' });
      seed([collegeFinal], { matchPeriodLayout: 'HALVES' });
      const { unmount } = renderPage();
      expect(await screen.findByTestId('root-admin-bracket-score-1-1-edit')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-score-1-2-edit')).not.toBeInTheDocument();
      expect(screen.getByTestId('root-admin-bracket-score-1-final-edit')).toBeInTheDocument();
      unmount();

      seed([superBowl()], { event: { ...playoffs, status: 'DRAFT' } });
      renderPage();
      await screen.findByTestId('root-admin-bracket-match-1');
      expect(screen.queryByTestId('root-admin-bracket-scores-1')).not.toBeInTheDocument();
    });

    it('offers no scores for a game still waiting on a team or a cancelled game', async () => {
      seed([
        superBowl(),
        match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3' }),
        match({ id: 'm-3', matchNumber: 3, roundNumber: 1, homeSportEventParticipantId: 'sep-4', awaySportEventParticipantId: 'sep-2', status: 'CANCELLED' }),
      ], { event: playoffs });
      renderPage();
      await screen.findByTestId('root-admin-bracket-scores-1');
      expect(screen.queryByTestId('root-admin-bracket-scores-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-bracket-scores-3')).not.toBeInTheDocument();
    });
  });

  describe('before release', () => {
    const draft = { ...tournament, status: 'DRAFT' as const };

    it('edits a pairing from the teams no other game holds, and offers no winner buttons', async () => {
      seed([
        match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME' }),
        match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', advancesToMatchId: 'm-3', advancesToSide: 'AWAY' }),
        match({ id: 'm-3', matchNumber: 3, roundNumber: 2 }),
      ], { event: draft });
      updateEventBracketMatchMock.mockResolvedValue({ data: { match: match({ id: 'm-2', matchNumber: 2, roundNumber: 1 }) } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-edit-2'));
      const away = screen.getByTestId('root-admin-bracket-side-2-AWAY');
      expect(within(away).getAllByRole('option').map((option) => option.textContent)).toEqual(['No team yet', '(2) Houston', '(15) Texas']);
      await userEvent.selectOptions(away, 'sep-4');
      await userEvent.click(screen.getByTestId('root-admin-bracket-save-2'));

      expect(updateEventBracketMatchMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', matchNumber: '2' },
        body: { homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4' },
      }));
      expect(screen.queryByTestId('root-admin-bracket-winner-1-HOME')).not.toBeInTheDocument();
      // The final's sides are both filled by earlier games, so it has no pairing to edit.
      expect(screen.queryByTestId('root-admin-bracket-edit-3')).not.toBeInTheDocument();
    });

    it('shows a refused pairing in product copy', async () => {
      seed([match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2' })], { event: draft });
      updateEventBracketMatchMock.mockResolvedValue({ error: { error: { code: 'BRACKET_INVALID', message: 'Match 1 cannot be changed: x.' } } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-bracket-edit-1'));
      await userEvent.click(screen.getByTestId('root-admin-bracket-save-1'));

      expect(await screen.findByTestId('root-admin-bracket-pairing-error-1')).toHaveTextContent(
        'That pairing could not be saved. Each team plays one opening game, and two different teams meet in a game.',
      );
    });

    it('marks a field row as a play-in place', async () => {
      seed([], { event: draft });
      updateEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
      renderPage();

      expect(await screen.findByTestId('root-admin-play-in-empty')).toHaveTextContent('No play-in places.');
      await userEvent.selectOptions(screen.getByTestId('root-admin-play-in-mark-select'), 'sep-4');
      await userEvent.click(screen.getByTestId('root-admin-play-in-mark'));

      expect(updateEventParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1' },
        body: { participants: [{ sportEventParticipantId: 'sep-4', isPlayInPlace: true }] },
      }));
    });
  });

  describe('play-in places after release', () => {
    const pairing = fieldEntryFixture({
      id: 'sep-5',
      participantId: 'p-5',
      seedNumber: 11,
      isPlayInPlace: true,
      participant: participantFixture({ id: 'p-5', name: 'Texas / Xavier' }),
    });
    const xavier = participantFixture({ id: 'p-6', name: 'Xavier', sportId: 'sport-basketball' });

    function seedPlayIn() {
      seed([], { field: [duke, vermont, houston, texas, pairing] });
      listSportsMock.mockResolvedValue({ data: { sports: [{ id: 'sport-basketball', sport: 'BASKETBALL', participantType: 'TEAM', tournamentFormat: 'MATCHES', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] } });
      rosterOf(duke.participant, texas.participant, xavier);
    }

    it('names a marked place\'s winner from the active teams not already in the tournament', async () => {
      seedPlayIn();
      setEventPlayInWinnerMock.mockResolvedValue({ data: { participant: pairing } });
      renderPage();

      const select = await screen.findByTestId('root-admin-play-in-winner-select-sep-5');
      await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose the winning team', 'Xavier']));
      await userEvent.selectOptions(select, 'p-6');
      await userEvent.click(screen.getByTestId('root-admin-play-in-winner-save-sep-5'));

      expect(setEventPlayInWinnerMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', sportEventParticipantId: 'sep-5' },
        body: { participantId: 'p-6' },
      }));
    });

    it('offers the teams on the tournament\'s league roster without reading the sport\'s whole list of teams', async () => {
      seedPlayIn();
      renderPage();

      const select = await screen.findByTestId('root-admin-play-in-winner-select-sep-5');
      await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose the winning team', 'Xavier']));
      expect(listParticipantsMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('root-admin-play-in-winner-search-sep-5')).not.toBeInTheDocument();
    });

    it('asks for 3 characters of a team\'s name when the league has no roster, then offers the matching teams not in the tournament', async () => {
      seedPlayIn();
      listParticipantLeagueAffiliationsMock.mockResolvedValue({ data: { affiliations: [] } });
      listParticipantsMock.mockResolvedValue({ data: { participants: [texas.participant, xavier] } });
      renderPage();

      const select = await screen.findByTestId('root-admin-play-in-winner-select-sep-5');
      await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Type at least 3 characters to find a team']));
      expect(select).toBeDisabled();
      expect(listParticipantsMock).not.toHaveBeenCalled();

      await userEvent.type(screen.getByTestId('root-admin-play-in-winner-search-sep-5'), 'Xav');

      await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose the winning team', 'Xavier']));
      expect(listParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportId: 'sport-basketball', status: 'ACTIVE', q: 'Xav' } }));
    });

    it('lists only the marked places', async () => {
      seedPlayIn();
      renderPage();

      await screen.findByTestId('root-admin-play-in-place-sep-5');
      expect(screen.queryByTestId('root-admin-play-in-place-sep-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-play-in-mark-select')).not.toBeInTheDocument();
    });

    it('shows a refused winner in product copy', async () => {
      seedPlayIn();
      setEventPlayInWinnerMock.mockResolvedValue({ error: { error: { code: 'EVENT_PARTICIPANT_ALREADY_ON_FIELD', message: 'Xavier is already on the field.' } } });
      renderPage();

      const select = await screen.findByTestId('root-admin-play-in-winner-select-sep-5');
      await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
      await userEvent.selectOptions(select, 'p-6');
      await userEvent.click(screen.getByTestId('root-admin-play-in-winner-save-sep-5'));

      expect(await screen.findByRole('alert')).toHaveTextContent('That team is already in the tournament.');
    });
  });

  // #704 slice 3: a team that withdraws before its first game is replaced in its place.
  describe('withdrawals', () => {
    const replacement = participantFixture({ id: 'p-6', name: 'Xavier', sportId: 'sport-basketball' });
    const firstRound = [
      match({ id: 'm1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', status: 'COMPLETED', winnerSide: 'HOME' }),
      match({ id: 'm2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4' }),
    ];

    function seedWithdrawals(matches: SportEventMatchDto[] = firstRound) {
      seed(matches);
      listSportsMock.mockResolvedValue({ data: { sports: [{ id: 'sport-basketball', sport: 'BASKETBALL', participantType: 'TEAM', tournamentFormat: 'MATCHES', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] } });
      rosterOf(duke.participant, replacement);
    }

    it('offers only the teams of games not yet started, and replaces the chosen one with a team not in the tournament', async () => {
      seedWithdrawals();
      replaceEventParticipantMock.mockResolvedValue({ data: { participant: fieldEntryFixture({ id: 'sep-6', participantId: 'p-6', participant: replacement }) } });
      renderPage();

      const withdrawn = await screen.findByTestId('root-admin-withdrawal-select');
      expect(within(withdrawn).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a team', '(2) Houston', '(15) Texas']);
      const replacedBy = screen.getByTestId('root-admin-withdrawal-replacement-select');
      await waitFor(() => expect(within(replacedBy).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a team', 'Xavier']));
      await userEvent.selectOptions(withdrawn, 'sep-4');
      await userEvent.selectOptions(replacedBy, 'p-6');
      await userEvent.click(screen.getByTestId('root-admin-withdrawal-replace'));

      expect(screen.getByTestId('root-admin-withdrawal-replace')).toHaveTextContent('Replace team');
      expect(replaceEventParticipantMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { eventId: 'evt-1', sportEventParticipantId: 'sep-4' },
        body: { participantId: 'p-6' },
      }));
    });

    it('offers replacements from the tournament\'s league roster without reading the sport\'s whole list of teams', async () => {
      seedWithdrawals();
      renderPage();

      const replacedBy = await screen.findByTestId('root-admin-withdrawal-replacement-select');
      await waitFor(() => expect(within(replacedBy).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a team', 'Xavier']));
      expect(listParticipantsMock).not.toHaveBeenCalled();
    });

    it('asks for 3 characters of a replacement\'s name when the league has no roster, then searches the sport for it', async () => {
      seedWithdrawals();
      listParticipantLeagueAffiliationsMock.mockResolvedValue({ data: { affiliations: [] } });
      listParticipantsMock.mockResolvedValue({ data: { participants: [replacement] } });
      renderPage();

      const replacedBy = await screen.findByTestId('root-admin-withdrawal-replacement-select');
      await waitFor(() => expect(within(replacedBy).getAllByRole('option').map((option) => option.textContent)).toEqual(['Type at least 3 characters to find a team']));
      expect(listParticipantsMock).not.toHaveBeenCalled();

      await userEvent.type(screen.getByTestId('root-admin-withdrawal-replacement-search'), 'Xav');

      await waitFor(() => expect(within(replacedBy).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a team', 'Xavier']));
      expect(listParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportId: 'sport-basketball', status: 'ACTIVE', q: 'Xav' } }));
    });

    it('leaves out a winner already placed in its next game, as the server refuses to replace it', async () => {
      seedWithdrawals([...firstRound, match({ id: 'm3', matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: 'sep-1' })]);
      renderPage();

      const withdrawn = await screen.findByTestId('root-admin-withdrawal-select');
      expect(within(withdrawn).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a team', '(2) Houston', '(15) Texas']);
    });

    it('leaves out a team placed straight into a later round, a bye, as the server replaces first-round places only', async () => {
      seedWithdrawals([...firstRound.slice(1), match({ id: 'm3', matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: 'sep-1' })]);
      renderPage();

      const withdrawn = await screen.findByTestId('root-admin-withdrawal-select');
      expect(within(withdrawn).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a team', '(2) Houston', '(15) Texas']);
    });

    it('shows no withdrawals card once every game has started, when a withdrawal is a walkover', async () => {
      seedWithdrawals(firstRound.slice(0, 1));
      renderPage();

      await screen.findByTestId('root-admin-bracket-round-1');
      expect(screen.queryByTestId('root-admin-withdrawals')).not.toBeInTheDocument();
    });

    it('shows a replacement refused as off the league\'s roster in product copy, naming the league by its own word', async () => {
      seedWithdrawals();
      replaceEventParticipantMock.mockResolvedValue({ error: { error: { code: 'PARTICIPANT_NOT_IN_SPORT_LEAGUE', message: 'Xavier is not on the roster.' } } });
      renderPage();

      const replacedBy = await screen.findByTestId('root-admin-withdrawal-replacement-select');
      await waitFor(() => expect(within(replacedBy).getAllByRole('option')).toHaveLength(2));
      await userEvent.selectOptions(screen.getByTestId('root-admin-withdrawal-select'), 'sep-3');
      await userEvent.selectOptions(replacedBy, 'p-6');
      await userEvent.click(screen.getByTestId('root-admin-withdrawal-replace'));

      expect(await screen.findByRole('alert')).toHaveTextContent('That team isn\'t on this league\'s roster, so they can\'t join this tournament. Pick another.');
    });

    it('shows a refused replacement in product copy', async () => {
      seedWithdrawals();
      replaceEventParticipantMock.mockResolvedValue({ error: { error: { code: 'BRACKET_PARTICIPANT_ALREADY_PLAYED', message: 'Match 2 has started.' } } });
      renderPage();

      const replacedBy = await screen.findByTestId('root-admin-withdrawal-replacement-select');
      await waitFor(() => expect(within(replacedBy).getAllByRole('option')).toHaveLength(2));
      await userEvent.selectOptions(screen.getByTestId('root-admin-withdrawal-select'), 'sep-3');
      await userEvent.selectOptions(replacedBy, 'p-6');
      await userEvent.click(screen.getByTestId('root-admin-withdrawal-replace'));

      expect(await screen.findByRole('alert')).toHaveTextContent('That team\'s game has started, so enter the withdrawal as a walkover.');
    });
  });
});
