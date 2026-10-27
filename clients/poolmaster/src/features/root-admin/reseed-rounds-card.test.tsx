import { MatchEnding } from '@poolmaster/shared/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoundMatchupDto, SportEventDto, SportEventMatchDto, SportLeagueDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventResultsPage } from './root-admin-sport-event-results-page';
import { fieldEntryFixture, participantFixture, sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';

// #722, #785: the NFL reseeds after Wild Card weekend. The admin asks the server to suggest the
// Divisional games from the seeds, can change any side, and saves the whole round in one go.
// MSW hands path parameters over as strings, so a round number reads '2'.

const {
  getEventMock,
  getEventBracketMock,
  listEventParticipantsMock,
  listSportsMock,
  listSportLeaguesMock,
  proposeEventRoundMatchupsMock,
  setEventRoundMatchupsMock,
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
    listSportsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    proposeEventRoundMatchupsMock: vi.fn(),
    setEventRoundMatchupsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  getEventBracket: getEventBracketMock,
  listEventParticipants: listEventParticipantsMock,
  listSports: listSportsMock,
  listSportLeagues: listSportLeaguesMock,
  proposeEventRoundMatchups: proposeEventRoundMatchupsMock,
  setEventRoundMatchups: setEventRoundMatchupsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const playoffs = sportEventFixture({
  id: 'evt-1',
  sport: 'AMERICAN_FOOTBALL',
  name: 'AFC Playoffs',
  status: 'IN_PROGRESS',
  rounds: 4,
  roundsPar: null,
  allowedTransitions: [],
});

function team(id: string, seedNumber: number, name: string) {
  return fieldEntryFixture({ id, participantId: `p-${id}`, seedNumber, participant: participantFixture({ id: `p-${id}`, name }) });
}

const chiefs = team('sep-1', 1, 'Chiefs');
const bills = team('sep-2', 2, 'Bills');
const ravens = team('sep-3', 3, 'Ravens');
const texans = team('sep-4', 4, 'Texans');
const chargers = team('sep-5', 5, 'Chargers');
const steelers = team('sep-6', 6, 'Steelers');

function match(overrides: Partial<SportEventMatchDto> & Pick<SportEventMatchDto, 'id' | 'matchNumber' | 'roundNumber'>): SportEventMatchDto {
  return {
    sportEventId: 'evt-1',
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
    isNeutralSite: false,
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

/**
 * Wild Card games link nowhere, so the Divisional round is reseeded: the Chiefs and Bills hold
 * its home sides on a bye and the Wild Card winners join them. The Divisional games feed the
 * Conference Championship by their links.
 */
function bracket(options: { wildCard?: 'final' | 'one-left'; divisional?: Partial<SportEventMatchDto> } = {}): SportEventMatchDto[] {
  const finished = options.wildCard !== 'one-left';
  return [
    match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-6', status: 'COMPLETED', winnerSide: 'HOME' }),
    match({
      id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-4', awaySportEventParticipantId: 'sep-5',
      ...(finished ? { status: 'COMPLETED', winnerSide: 'HOME' } : {}),
    }),
    match({ id: 'm-3', matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: 'sep-1', advancesToMatchId: 'm-5', advancesToSide: 'HOME', ...options.divisional }),
    match({ id: 'm-4', matchNumber: 4, roundNumber: 2, homeSportEventParticipantId: 'sep-2', advancesToMatchId: 'm-5', advancesToSide: 'AWAY' }),
    match({ id: 'm-5', matchNumber: 5, roundNumber: 3 }),
  ];
}

const proposal: RoundMatchupDto[] = [
  { matchNumber: 3, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-4' },
  { matchNumber: 4, homeSportEventParticipantId: 'sep-2', awaySportEventParticipantId: 'sep-3' },
];

// The league's own round names: a heading reading one proves the league has loaded, so a card
// that depends on it being absent is absent for the right reason.
const LEAGUE_ROUND_NAMES = ['Wild Card Round', 'Divisional Round', 'Conference Championship', 'Super Bowl'];

/** Waits for the bracket and the league both to load. */
async function findLoadedDivisionalRound() {
  await waitFor(() => expect(within(screen.getByTestId('root-admin-bracket-round-2')).getByRole('heading')).toHaveTextContent('Divisional Round'));
}

function seed(matches: SportEventMatchDto[], options: { event?: SportEventDto; bracketAdvancement?: SportLeagueDto['bracketAdvancement'] } = {}) {
  getEventMock.mockResolvedValue({ data: { event: options.event ?? playoffs } });
  listSportLeaguesMock.mockResolvedValue({
    data: {
      sportLeagues: [sportLeagueFixture({
        id: playoffs.sportLeagueId,
        sportId: 'sport-american-football',
        name: 'NFL',
        bracketAdvancement: options.bracketAdvancement ?? 'RESEED_BY_SEED',
        roundNames: LEAGUE_ROUND_NAMES,
      })],
    },
  });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: [chiefs, bills, ravens, texans, chargers, steelers] } });
  getEventBracketMock.mockResolvedValue({ data: { matches } });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/american-football/events/evt-1/results']}>
        <Routes>
          <Route element={<RootAdminSportEventResultsPage />} path="/manage/sports/:sport/events/:eventId/results" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Reseeded rounds on the NFL playoffs results page', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('offers to suggest the Divisional games once the Wild Card results are in, for a released league that reseeds', async () => {
    seed(bracket());
    renderPage();

    const round = await screen.findByTestId('root-admin-reseed-round-2');
    expect(within(round).getByRole('heading')).toHaveTextContent('Divisional Round');
    expect(screen.getByTestId('root-admin-reseed-suggest-2')).toBeEnabled();
    expect(screen.getByTestId('root-admin-reseed-suggest-2')).toHaveTextContent('Suggest games');
    expect(screen.queryByTestId('root-admin-reseed-round-3')).not.toBeInTheDocument();
  });

  it('shows no reseed card for a league whose bracket is fixed by its links', async () => {
    seed(bracket(), { bracketAdvancement: 'FIXED' });
    renderPage();

    await findLoadedDivisionalRound();
    expect(screen.queryByTestId('root-admin-reseed')).not.toBeInTheDocument();
  });

  it('shows no reseed card before the playoffs are released', async () => {
    seed(bracket(), { event: { ...playoffs, status: 'DRAFT' } });
    renderPage();

    await findLoadedDivisionalRound();
    expect(screen.queryByTestId('root-admin-reseed')).not.toBeInTheDocument();
  });

  it('shows no reseed card for cancelled playoffs, whose later rounds will not be played', async () => {
    seed(bracket(), { event: { ...playoffs, status: 'CANCELLED' } });
    renderPage();

    await findLoadedDivisionalRound();
    expect(screen.queryByTestId('root-admin-reseed')).not.toBeInTheDocument();
  });

  it('holds back the suggestion and names the Wild Card game still without a result', async () => {
    seed(bracket({ wildCard: 'one-left' }));
    renderPage();

    expect(await screen.findByTestId('root-admin-reseed-waiting-2')).toHaveTextContent(
      'Enter the result of every Wild Card Round game first. Game 2 has no result yet.',
    );
    expect(screen.getByTestId('root-admin-reseed-suggest-2')).toBeDisabled();
    expect(proposeEventRoundMatchupsMock).not.toHaveBeenCalled();
  });

  it('fills each Divisional game\'s home and away selects from the server\'s suggestion', async () => {
    seed(bracket());
    proposeEventRoundMatchupsMock.mockResolvedValue({ data: { matches: proposal } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-reseed-suggest-2'));

    expect(await screen.findByTestId('root-admin-reseed-3-HOME')).toHaveValue('sep-1');
    expect(proposeEventRoundMatchupsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'evt-1', roundNumber: '2' } }));
    expect(screen.getByTestId('root-admin-reseed-3-AWAY')).toHaveValue('sep-4');
    expect(screen.getByTestId('root-admin-reseed-4-HOME')).toHaveValue('sep-2');
    expect(screen.getByTestId('root-admin-reseed-4-AWAY')).toHaveValue('sep-3');
    const options = within(screen.getByTestId('root-admin-reseed-3-AWAY')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['(1) Chiefs', '(2) Bills', '(3) Ravens', '(4) Texans']);
  });

  it('saves every game of the round, with the admin\'s change, and reloads the bracket', async () => {
    seed(bracket());
    proposeEventRoundMatchupsMock.mockResolvedValue({ data: { matches: proposal } });
    setEventRoundMatchupsMock.mockResolvedValue({ data: { matches: bracket() } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-reseed-suggest-2'));
    await userEvent.selectOptions(await screen.findByTestId('root-admin-reseed-3-AWAY'), 'sep-3');
    await userEvent.selectOptions(screen.getByTestId('root-admin-reseed-4-AWAY'), 'sep-4');
    await userEvent.click(screen.getByTestId('root-admin-reseed-save-2'));

    expect(setEventRoundMatchupsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1', roundNumber: '2' },
      body: {
        matches: [
          { matchNumber: 3, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-3' },
          { matchNumber: 4, homeSportEventParticipantId: 'sep-2', awaySportEventParticipantId: 'sep-4' },
        ],
      },
    }));
    await waitFor(() => expect(getEventBracketMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('root-admin-reseed-saved-2')).toHaveTextContent('Games saved. They can change until the round starts.');
  });

  it('refuses to save a team picked twice before sending the round', async () => {
    seed(bracket());
    proposeEventRoundMatchupsMock.mockResolvedValue({ data: { matches: proposal } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-reseed-suggest-2'));
    await userEvent.selectOptions(await screen.findByTestId('root-admin-reseed-3-AWAY'), 'sep-3');

    expect(screen.getByTestId('root-admin-reseed-repeated-2')).toHaveTextContent('Each team plays once.');
    expect(screen.getByTestId('root-admin-reseed-save-2')).toBeDisabled();
  });

  it('shows the server\'s refusal of the saved games in product copy', async () => {
    seed(bracket());
    proposeEventRoundMatchupsMock.mockResolvedValue({ data: { matches: proposal } });
    setEventRoundMatchupsMock.mockResolvedValue({
      error: { error: { code: 'BRACKET_INVALID', message: 'Round 2 cannot be set: match 3 home moves a team that holds match 3 home.' } },
      response: { status: 422 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-reseed-suggest-2'));
    await userEvent.selectOptions(await screen.findByTestId('root-admin-reseed-3-HOME'), 'sep-4');
    await userEvent.selectOptions(screen.getByTestId('root-admin-reseed-3-AWAY'), 'sep-1');
    await userEvent.click(screen.getByTestId('root-admin-reseed-save-2'));

    expect(await screen.findByTestId('root-admin-reseed-save-error-2')).toHaveTextContent(
      'These games could not be saved. Each team left plays once, against a team from its own side of the bracket, and a team with a bye keeps its place.',
    );
  });

  it('shows the server\'s refusal to suggest a round whose games have begun in product copy', async () => {
    seed(bracket());
    proposeEventRoundMatchupsMock.mockResolvedValue({
      error: { error: { code: 'BRACKET_ROUND_ALREADY_PLAYED', message: 'Round 2 cannot be placed: match 3 of round 2 has started.' } },
      response: { status: 409 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-reseed-suggest-2'));

    expect(await screen.findByTestId('root-admin-reseed-error-2')).toHaveTextContent(
      'A game of this round has started, so its games can no longer change.',
    );
  });

  it('no longer offers a Divisional round once one of its games has a quarter\'s score', async () => {
    seed(bracket({ divisional: { awaySportEventParticipantId: 'sep-4', periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 0 }] } }));
    renderPage();

    await findLoadedDivisionalRound();
    expect(screen.queryByTestId('root-admin-reseed')).not.toBeInTheDocument();
  });
});
