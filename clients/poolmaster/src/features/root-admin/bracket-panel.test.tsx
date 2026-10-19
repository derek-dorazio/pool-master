import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventDto, SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventResultsPage } from './root-admin-sport-event-results-page';
import { fieldEntryFixture, participantFixture, sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';

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
  updateEventBracketMatchMock,
  updateEventParticipantsMock,
  setEventPlayInWinnerMock,
  listSportsMock,
  listParticipantsMock,
  listSportLeaguesMock,
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
    updateEventBracketMatchMock: vi.fn(),
    updateEventParticipantsMock: vi.fn(),
    setEventPlayInWinnerMock: vi.fn(),
    listSportsMock: vi.fn(),
    listParticipantsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  getEventBracket: getEventBracketMock,
  listEventParticipants: listEventParticipantsMock,
  recordEventMatchResult: recordEventMatchResultMock,
  clearEventMatchResult: clearEventMatchResultMock,
  updateEventBracketMatch: updateEventBracketMatchMock,
  updateEventParticipants: updateEventParticipantsMock,
  setEventPlayInWinner: setEventPlayInWinnerMock,
  listSports: listSportsMock,
  listParticipants: listParticipantsMock,
  listSportLeagues: listSportLeaguesMock,
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
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    ...overrides,
  };
}

function seed(matches: SportEventMatchDto[], options: { event?: SportEventDto; field?: SportEventParticipantDto[]; roundNames?: string[] } = {}) {
  getEventMock.mockResolvedValue({ data: { event: options.event ?? tournament } });
  listSportLeaguesMock.mockResolvedValue({
    data: { sportLeagues: [sportLeagueFixture({ id: tournament.sportLeagueId, name: 'NCAA Division I Men', roundNames: options.roundNames ?? [] })] },
  });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: options.field ?? [duke, vermont, houston, texas] } });
  getEventBracketMock.mockResolvedValue({ data: { matches } });
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

  it('explains in product copy that a winner who already played the next game must have that result cleared first', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME', status: 'COMPLETED', winnerSide: 'HOME' }),
      match({ id: 'm-3', matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-3', status: 'COMPLETED', winnerSide: 'HOME' }),
    ]);
    recordEventMatchResultMock.mockResolvedValue({ error: { error: { code: 'SPORT_EVENT_MATCH_RESULT_LOCKED', message: 'Match 1 winner already played match 3.' } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-bracket-winner-1-AWAY'));

    expect(await screen.findByTestId('root-admin-bracket-error-1')).toHaveTextContent(
      "This game's winner has already played game 3. Clear that result first.",
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
      listParticipantsMock.mockResolvedValue({ data: { participants: [duke.participant, texas.participant, xavier].map((participant) => participantFixture({ ...participant, sportId: 'sport-basketball' })) } });
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
});
