import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { CreateContestPage } from './create-contest-page';

const {
  createContestMock,
  getEventBracketMock,
  getLeagueByCodeMock,
  getSportLeagueMock,
  listContestConfigTemplatesMock,
  listEventParticipantsMock,
  listEventsMock,
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

  logger.child.mockImplementation(() => logger);

  return {
    createContestMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    getLeagueByCodeMock: vi.fn(),
    getSportLeagueMock: vi.fn(),
    listContestConfigTemplatesMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createContest: createContestMock,
  getEventBracket: getEventBracketMock,
  getLeagueByCode: getLeagueByCodeMock,
  getSportLeague: getSportLeagueMock,
  listContestConfigTemplates: listContestConfigTemplatesMock,
  listEventParticipants: listEventParticipantsMock,
  listEvents: listEventsMock,
});

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'commissioner@example.com',
      username: 'commissioner@example.com',
      firstName: 'Casey',
      lastName: 'Commissioner',
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

function AdminContestDestination() {
  const { contestId } = useParams<{ contestId: string }>();
  return <div data-testid="admin-contest-destination">{contestId}</div>;
}

function renderCreateContestPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/admin/contests/new']}>
        <Routes>
          <Route element={<CreateContestPage />} path="/league/:leagueCode/admin/contests/new" />
          <Route element={<AdminContestDestination />} path="/league/:leagueCode/admin/contests/:contestId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeCommonMocks() {
  getLeagueByCodeMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        description: 'A test league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 2,
        activeContestCount: 0,
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      // #202 (A8) — the viewer's own membership, delivered once with the league context. It was
      // `memberType` and a `leagueRelationship` block on the league itself.
      membership: {
        id: 'league-membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'commissioner@example.com',
          username: 'commissioner@example.com',
          firstName: 'Casey',
          lastName: 'Commissioner',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
        role: 'COMMISSIONER',
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
      squadMembership: null,
    },
  });
  listEventsMock.mockResolvedValue({
    data: {
      events: [
        {
          id: 'event-2',
          sport: 'GOLF',
          name: 'RBC Heritage',
          venue: 'Harbour Town',
          status: 'SCHEDULED',
          startDate: '2099-04-16T12:00:00.000Z',
          participantCount: 132,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
          tierCount: 5,
        },
        {
          id: 'event-1',
          sport: 'GOLF',
          name: 'Masters Tournament',
          venue: 'Augusta National',
          status: 'SCHEDULED',
          startDate: '2099-04-09T12:00:00.000Z',
          participantCount: 144,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
          tierCount: 6,
        },
        {
          id: 'event-3',
          sport: 'GOLF',
          name: 'Zurich Classic',
          status: 'SCHEDULED',
          startDate: '2099-04-23T12:00:00.000Z',
          participantCount: 0,
          readinessStatus: 'PENDING_FIELD',
          readinessReasons: ['FIELD_NOT_LOADED'],
          contestEligible: false,
          tierCount: 0,
        },
      ],
    },
  });
  listContestConfigTemplatesMock.mockResolvedValue({
    data: {
      templates: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          sport: 'GOLF',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          templateKey: 'golf-tiered-pick-6',
          name: 'Select one from each tier, 4 count',
          description: 'Default golf tiered template',
          sortOrder: 1,
          isDefault: true,
          active: true,
          schemaVersion: 1,
          configuration: {
            maxEntriesPerSquad: 1,
            selectionType: 'TIERED',
            picksPerTier: 1,
            countedScores: 4,
          },
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          sport: 'GOLF',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          templateKey: 'golf-tiered-pick-12',
          name: 'Select two from each tier, 8 count',
          description: 'Pick two golfers from each seeded tier.',
          sortOrder: 2,
          isDefault: false,
          active: true,
          schemaVersion: 1,
          configuration: {
            maxEntriesPerSquad: 1,
            selectionType: 'TIERED',
            picksPerTier: 2,
            countedScores: 8,
          },
        },
      ],
    },
  });
}

function singleEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      events: [
        {
          id: 'event-1',
          sport: 'GOLF',
          name: 'Masters Tournament',
          status: 'SCHEDULED',
          startDate: '2099-04-09T12:00:00.000Z',
          participantCount: 144,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
          tierCount: 6,
          ...overrides,
        },
      ],
    },
  };
}

/** A contest-ready basketball tournament of three rounds, unless told otherwise. */
function basketballEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bb-1',
    sport: 'BASKETBALL',
    name: 'March Madness',
    venue: null,
    status: 'SCHEDULED',
    startDate: '2099-03-19T16:00:00.000Z',
    participantCount: 8,
    readinessStatus: 'CONTEST_ELIGIBLE',
    readinessReasons: [],
    contestEligible: true,
    tierCount: 4,
    rounds: 3,
    sportLeagueId: 'ncaa-men',
    ...overrides,
  };
}

/** A six-round March Madness already under way: released with its field, only started. */
const MARCH_MADNESS_UNDER_WAY = {
  id: 'bb-live',
  name: 'March Madness Live',
  status: 'IN_PROGRESS',
  startDate: '2026-03-19T16:00:00.000Z',
  readinessStatus: 'EVENT_STARTED',
  readinessReasons: ['EVENT_STARTED'],
  contestEligible: false,
  rounds: 6,
} as const;

/**
 * The golf reads, plus basketball's events (one contest-ready tournament of three rounds unless
 * told otherwise) with no presets of their own and a sport league with no round names of its own,
 * as the reads answer when Basketball is chosen.
 */
function primeBasketballMocks(events: Array<Record<string, unknown>> = [basketballEvent()], roundNames: string[] = []) {
  primeCommonMocks();
  getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'ncaa-men', name: 'NCAA Men', roundNames } } });
  const golfEvents = listEventsMock.getMockImplementation() as ((options: unknown) => Promise<unknown>) | undefined;
  listEventsMock.mockImplementation((options: { query?: { sport?: string } }): Promise<unknown> => (options.query?.sport === 'BASKETBALL'
    ? Promise.resolve({ data: { events } })
    : golfEvents?.(options) ?? Promise.resolve({ data: { events: [] } })));
  const golfTemplates = listContestConfigTemplatesMock.getMockImplementation() as ((options: unknown) => Promise<unknown>) | undefined;
  listContestConfigTemplatesMock.mockImplementation((options: { query?: { sport?: string } }): Promise<unknown> => (options.query?.sport === 'BASKETBALL'
    ? Promise.resolve({ data: { templates: [] } })
    : golfTemplates?.(options) ?? Promise.resolve({ data: { templates: [] } })));
}

function submittedBody() {
  const [request] = createContestMock.mock.calls[0] as [{ body: Record<string, unknown> }];
  return request.body;
}

/** The soonest event, the default preset and the suggested name are set once the reads land. */
async function waitForStartingChoices() {
  await waitFor(() => expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toBeChecked());
  await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Pick 6'));
}

describe('Commissioner tools › Contests › Create contest', () => {
  afterEach(() => {
    createContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    getSportLeagueMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('starts with the soonest contest-ready event, the default preset, and a name suggested from them', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    // The soonest event and the default preset are chosen once the reads land.
    await waitFor(() => expect(screen.getByTestId('contest-event-event-1')).toBeChecked());
    await waitFor(() => expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toBeChecked());
    expect(screen.getByTestId('contest-event-event-2')).not.toBeChecked();
    expect(screen.queryByTestId('contest-event-event-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-event-event-1')).toHaveTextContent('144 golfers · 6 tiers');
    expect(screen.getByTestId('contest-format-TIERED')).toBeChecked();
    expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toBeChecked();
    expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toHaveTextContent('Pick 6, best 4');
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Pick 6'));
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent(
      'Masters Tournament Pick 6 · Masters TournamentPick 1 golfer from each of 6 tiers. The best 4 scores count. 1 entry per member.',
    );
    expect(screen.getByTestId('create-contest-submit')).toHaveTextContent('Create contest');
  });

  it('creates the contest from the chosen event, preset and rules, then lands on the new contest\'s page', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-90' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByTestId('admin-contest-destination')).toHaveTextContent('contest-90');
    expect(createContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
    expect(submittedBody()).toEqual({
      name: 'Masters Tournament Pick 6',
      sportEventIds: ['event-1'],
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      templateId: '11111111-1111-4111-8111-111111111111',
      configuration: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 },
    });
  });

  it('moves the suggested name and the tiers with the event chosen', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-event-event-2'));

    expect(screen.getByTestId('contest-event-event-2')).toBeChecked();
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('RBC Heritage Pick 5'));
    expect(screen.getByText('5 tiers × 1 = 5 golfers per entry')).toBeInTheDocument();
  });

  it('keeps the suggested name in step with the preset until the commissioner types their own', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-template-golf-tiered-pick-12'));
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Pick 12'));

    fireEvent.change(screen.getByTestId('contest-name'), { target: { value: 'Spring Major' } });
    fireEvent.click(screen.getByTestId('contest-template-golf-tiered-pick-6'));

    expect(screen.getByTestId('contest-name')).toHaveValue('Spring Major');
  });

  it('applies the pick-12 preset: two picks per tier on six tiers is twelve golfers, eight counting', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-12' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    const pick12 = screen.getByTestId('contest-template-golf-tiered-pick-12');
    expect(pick12).toHaveTextContent('Pick 12, best 8');
    fireEvent.click(pick12);

    expect(screen.getByTestId('contest-tiered-picks-per-tier')).toHaveValue(2);
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(8);
    expect(screen.getByText('6 tiers × 2 = 12 golfers per entry')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toEqual(expect.objectContaining({
      templateId: '33333333-3333-4333-8333-333333333333',
      configuration: { selectionType: 'TIERED', picksPerTier: 2, countedScores: 8, maxEntriesPerSquad: 1 },
    }));
  });

  it('switches to Custom when a rule is changed by hand, and creates without a preset', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-custom' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('contest-max-entries-unlimited'));

    expect(screen.getByTestId('contest-template-custom')).toBeChecked();
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent('The best 5 scores count. No limit on entries per member.');
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).not.toHaveProperty('templateId');
    expect(submittedBody()).toEqual(expect.objectContaining({ configuration: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 5 } }));
  });

  it('resets scores that count to all but two tiers\' worth when picks per tier changes', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    expect(screen.getByText('6 tiers × 1 = 6 golfers per entry')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), { target: { value: '2' } });

    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(8);
    expect(screen.getByText('6 tiers × 2 = 12 golfers per entry')).toBeInTheDocument();
  });

  it('keeps a selected preset\'s own scores that count over the event\'s tier-count default', async () => {
    primeCommonMocks();
    listEventsMock.mockResolvedValue(singleEvent());
    // The presets wait for the event (they are the event's sport league's), so the tier
    // count is known, and its default applied, before the preset arrives.
    let releaseTemplates: (value: unknown) => void = () => undefined;
    listContestConfigTemplatesMock.mockReturnValue(new Promise((resolve) => { releaseTemplates = resolve; }));

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('contest-event-event-1')).toBeChecked());
    await waitFor(() => expect(listContestConfigTemplatesMock).toHaveBeenCalled());
    releaseTemplates({
      data: {
        templates: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            sport: 'GOLF',
            contestFormat: 'ROSTER',
            selectionType: 'TIERED',
            templateKey: 'golf-tiered-custom',
            name: 'Select two from each tier, 10 count',
            description: 'A root admin template that departs from the formula.',
            sortOrder: 1,
            isDefault: true,
            active: true,
            schemaVersion: 1,
            configuration: { maxEntriesPerSquad: 1, selectionType: 'TIERED', picksPerTier: 2, countedScores: 10 },
          },
        ],
      },
    });

    await screen.findByText('6 tiers × 2 = 12 golfers per entry');
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(10);
  });

  it('starts scores that count at the chosen event\'s tier count less two when there is no preset', async () => {
    primeCommonMocks();
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [] } });
    listEventsMock.mockResolvedValue(singleEvent({ tierCount: 4 }));

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(2));
    expect(screen.getByText('4 tiers × 1 = 4 golfers per entry')).toBeInTheDocument();
    expect(screen.getByTestId('contest-template-custom')).toBeChecked();
  });

  it('keeps Create contest disabled and says why while the rules are incomplete or out of range', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('create-contest-submit')).toBeEnabled());

    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), { target: { value: '' } });
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();
    expect(screen.getByTestId('contest-rules-error')).toHaveTextContent('Picks per tier must be a positive whole number.');

    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), { target: { value: '7' } });
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();
    expect(screen.getByTestId('contest-rules-error')).toHaveTextContent('Scores that count must be between 1 and the 6 golfers picked.');
    expect(screen.queryByTestId('contest-members-will-see')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), { target: { value: '6' } });
    expect(screen.getByTestId('create-contest-submit')).toBeEnabled();
    expect(createContestMock).not.toHaveBeenCalled();
  });

  it('refuses a contest with its name cleared, without sending anything', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.change(screen.getByTestId('contest-name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByText('Contest name is required.')).toBeInTheDocument();
    expect(createContestMock).not.toHaveBeenCalled();
  });

  it('shows the server\'s message when contest creation is refused', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_NAME_IN_USE', message: 'Contest name is already in use.' } },
    });

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('create-contest-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await screen.findByText('Contest name is already in use.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contest.create.failed' }),
      expect.any(String),
    );
  });

  it('offers basketball\'s roster formats, Pick\'em and Bracket', async () => {
    primeCommonMocks();
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));

    await waitFor(() => expect(screen.getByTestId('contest-sport-BASKETBALL')).toBeChecked());
    expect(screen.getByTestId('contest-format-TIERED')).toBeInTheDocument();
    expect(screen.getByTestId('contest-format-BUDGET_PICK')).toBeInTheDocument();
    expect(screen.getByTestId('contest-format-RANDOM_DRAW')).toBeInTheDocument();
    expect(screen.getByTestId('contest-format-PICK_EM')).toHaveTextContent('Pick’em');
    expect(screen.getByTestId('contest-format-BRACKET')).toBeInTheDocument();
  });

  it('creates a confidence pick\'em on its first week as a prediction contest with the mode chosen and no scoring settings, since the mode alone scores it', async () => {
    primeBasketballMocks([basketballEvent({ id: 'week-1', name: 'Week 1', rounds: 1 })]);
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-pick-em' } } });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    await waitFor(() => expect(screen.getByTestId('contest-event-week-1')).toBeChecked());
    fireEvent.click(screen.getByTestId('contest-format-PICK_EM'));

    expect(await screen.findByTestId('contest-pick-em-mode-STRAIGHT_UP')).toBeChecked();
    expect(screen.getByTestId('create-contest-event')).toHaveTextContent('you add the rest of the season from its Events page');
    expect(screen.queryByTestId('contest-scoring-round-values')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('contest-pick-em-mode-CONFIDENCE'));
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Week 1 Pick’em'));
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent('Pick the winner of every game, then rank each week’s picks by confidence.');
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toEqual({
      name: 'Week 1 Pick’em',
      sportEventIds: ['week-1'],
      contestFormat: 'PREDICTION',
      selectionType: 'PICK_EM',
      configuration: { selectionType: 'PICK_EM', mode: 'CONFIDENCE', againstTheSpread: false, maxEntriesPerSquad: 1 },
    });
  });

  it('offers Bracket on a basketball knockout event and creates a prediction contest with the bracket rules and the round points typed', async () => {
    primeBasketballMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-bracket' } } });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-1')).toBeChecked());
    expect(screen.getByTestId('contest-format-BRACKET')).toHaveTextContent('Bracket');
    fireEvent.click(screen.getByTestId('contest-format-BRACKET'));

    expect(await screen.findByTestId('contest-bracket-rules')).toBeInTheDocument();
    expect(screen.getByTestId('contest-bracket-starts-at-round')).toHaveDisplayValue('Full bracket');
    expect(screen.getByText('Points for a correct pick')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4' } });
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('March Madness Bracket'));
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent(
      'Fill in the whole bracket before the first game: pick the winner of every game, all the way to the final. Points for a win in each round: 1, 2, 4. 1 entry per member.',
    );
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toEqual({
      name: 'March Madness Bracket',
      sportEventIds: ['bb-1'],
      contestFormat: 'PREDICTION',
      selectionType: 'BRACKET',
      configuration: {
        selectionType: 'BRACKET',
        startsAtRound: 1,
        maxEntriesPerSquad: 1,
        scoring: {
          participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
          config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'NONE' } },
        },
      },
    });
  });

  it('offers a bracket on an event that has not started only as a full bracket, since its later rounds have no teams yet', async () => {
    primeBasketballMocks([basketballEvent({ rounds: 6 })]);
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-1')).toBeChecked());
    fireEvent.click(screen.getByTestId('contest-format-BRACKET'));

    const startsAt = await screen.findByTestId('contest-bracket-starts-at-round');
    expect(within(startsAt).getAllByRole('option').map((option) => option.textContent)).toEqual(['Full bracket']);
  });

  it('starts the bracket over at the full bracket when the commissioner switches from a knockout under way to one that has not started', async () => {
    primeBasketballMocks([basketballEvent({ rounds: 6 }), basketballEvent(MARCH_MADNESS_UNDER_WAY)]);
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-bracket' } } });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    fireEvent.click(await screen.findByTestId('contest-format-BRACKET'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-1')).toBeChecked());
    fireEvent.click(screen.getByTestId('contest-event-bb-live'));
    await waitFor(() => expect(screen.getByTestId('contest-bracket-starts-at-round')).toHaveDisplayValue('From the Second Round'));
    fireEvent.click(screen.getByTestId('contest-event-bb-1'));

    await waitFor(() => expect(screen.getByTestId('contest-bracket-starts-at-round')).toHaveDisplayValue('Full bracket'));
    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4, 8, 16, 32' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toMatchObject({
      sportEventIds: ['bb-1'],
      configuration: { selectionType: 'BRACKET', startsAtRound: 1 },
    });
  });

  it('offers a six-round knockout under way each later round but the final by its round names, and creates a second-chance bracket from the Sweet 16', async () => {
    primeBasketballMocks([basketballEvent(MARCH_MADNESS_UNDER_WAY)]);
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-second-chance' } } });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    fireEvent.click(await screen.findByTestId('contest-format-BRACKET'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-live')).toBeChecked());

    const startsAt = screen.getByTestId('contest-bracket-starts-at-round');
    expect(within(startsAt).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'From the Second Round',
      'From the Sweet 16',
      'From the Elite Eight',
      'From the Final Four',
    ]);
    fireEvent.change(startsAt, { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4, 8, 16, 32' } });

    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('March Madness Live Second-Chance Bracket'));
    expect(screen.getByTestId('contest-bracket-rules')).toHaveTextContent(
      'Second-chance bracket from the Sweet 16: pick the winner of every game from the Sweet 16 on, all the way to the final, before its first game.',
    );
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent('Second-chance bracket from the Sweet 16');
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toMatchObject({
      name: 'March Madness Live Second-Chance Bracket',
      selectionType: 'BRACKET',
      configuration: { selectionType: 'BRACKET', startsAtRound: 3 },
    });
  });

  it('names the starting rounds by the event\'s sport league\'s own round names where it has them', async () => {
    primeBasketballMocks(
      [basketballEvent(MARCH_MADNESS_UNDER_WAY)],
      ['First Round', 'Round of 32', 'Sweet Sixteen', 'Regional Final', 'National Semifinal', 'Title Game'],
    );
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    fireEvent.click(await screen.findByTestId('contest-format-BRACKET'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-live')).toBeChecked());

    expect(await screen.findByRole('option', { name: 'From the Sweet Sixteen' })).toBeInTheDocument();
    expect(getSportLeagueMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'ncaa-men' } }));
  });

  it('lists a knockout under way only for a bracket, offers only its later rounds, and creates a second-chance bracket from the second round', async () => {
    primeBasketballMocks([basketballEvent(MARCH_MADNESS_UNDER_WAY)]);
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-second-chance' } } });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    expect(await screen.findByTestId('create-contest-no-events')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('contest-format-BRACKET'));

    await waitFor(() => expect(screen.getByTestId('contest-event-bb-live')).toBeChecked());
    expect(screen.getByTestId('contest-event-bb-live')).toHaveTextContent('Under way');
    const startsAt = screen.getByTestId('contest-bracket-starts-at-round');
    expect(startsAt).toHaveDisplayValue('From the Second Round');
    expect(screen.queryByRole('option', { name: 'Full bracket' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4, 8, 16, 32' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toMatchObject({
      sportEventIds: ['bb-live'],
      configuration: { selectionType: 'BRACKET', startsAtRound: 2 },
    });
  });

  it('shows the server\'s own words when a second-chance bracket\'s starting round has already started', async () => {
    primeBasketballMocks([basketballEvent(MARCH_MADNESS_UNDER_WAY)]);
    createContestMock.mockResolvedValue({
      error: {
        error: {
          code: 'SPORT_EVENT_ALREADY_STARTED',
          message: 'The bracket\'s starting round has already started, so a bracket can no longer start there.',
        },
      },
      status: 422,
    });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    fireEvent.click(await screen.findByTestId('contest-format-BRACKET'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-live')).toBeChecked());
    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4, 8, 16, 32' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByText('The bracket\'s starting round has already started, so a bracket can no longer start there.')).toBeInTheDocument();
  });

  it('says a bracket needs games that fill in as one when the server refuses the event with CONTEST_EVENT_NOT_A_BRACKET', async () => {
    primeBasketballMocks();
    createContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_EVENT_NOT_A_BRACKET', message: 'Not a bracket.' } },
      status: 422,
    });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-BASKETBALL'));
    await waitFor(() => expect(screen.getByTestId('contest-event-bb-1')).toBeChecked());
    fireEvent.click(screen.getByTestId('contest-format-BRACKET'));
    fireEvent.change(screen.getByTestId('contest-scoring-round-values'), { target: { value: '1, 2, 4' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByText(/can’t be filled in as a bracket yet/)).toBeInTheDocument();
  });

  it('says no event is available and keeps Create contest disabled when no golf event is contest-ready', async () => {
    primeCommonMocks();
    listEventsMock.mockResolvedValue(singleEvent({
      participantCount: 0,
      readinessStatus: 'PENDING_FIELD',
      readinessReasons: ['FIELD_NOT_LOADED'],
      contestEligible: false,
    }));

    renderCreateContestPage();

    expect(await screen.findByTestId('create-contest-no-events')).toHaveTextContent(
      'No golf events are currently available for contest setup.',
    );
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();
  });
});

describe('Commissioner tools › Contests › Create contest › a sport league\'s own presets', () => {
  const LPGA_LEAGUE_ID = '62400000-0000-4000-8000-000000000001';
  const SPORT_WIDE_DEFAULT = {
    id: '11111111-1111-4111-8111-111111111111',
    sport: 'GOLF',
    sportLeagueId: null,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    templateKey: 'golf-tiered-pick-6',
    name: 'Select one from each tier, 4 count',
    description: 'Sport-wide golf default',
    sortOrder: 1,
    isDefault: true,
    active: true,
    schemaVersion: 1,
    configuration: { maxEntriesPerSquad: 1, selectionType: 'TIERED', picksPerTier: 1, countedScores: 4 },
  };
  const leaguePreset = (isDefault: boolean) => ({
    ...SPORT_WIDE_DEFAULT,
    id: '62400000-0000-4000-8000-000000000002',
    sportLeagueId: LPGA_LEAGUE_ID,
    templateKey: 'lpga-tiered-pick-12',
    name: 'Select two from each tier, 8 count',
    description: 'The LPGA-style tour\'s own preset',
    // A league default is listed after the sport-wide default and a league non-default before it,
    // so which one starts checked is the default rule, not the list order.
    sortOrder: isDefault ? 2 : 0,
    isDefault,
    configuration: { maxEntriesPerSquad: 1, selectionType: 'TIERED', picksPerTier: 2, countedScores: 8 },
  });

  /** One LPGA-style event; the list answers that league's preset only when asked for the league. */
  function primeLeagueMocks(leagueDefault: boolean) {
    primeCommonMocks();
    listEventsMock.mockResolvedValue(singleEvent({ sportLeagueId: LPGA_LEAGUE_ID }));
    listContestConfigTemplatesMock.mockImplementation((options: { query?: { sportLeagueId?: string } }) => ({
      data: {
        templates: options.query?.sportLeagueId === LPGA_LEAGUE_ID
          ? [leaguePreset(leagueDefault), SPORT_WIDE_DEFAULT].sort((left, right) => left.sortOrder - right.sortOrder)
          : [SPORT_WIDE_DEFAULT],
      },
    }));
  }

  afterEach(() => {
    createContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
  });

  it('asks for the chosen event\'s sport league\'s presets and starts on that league\'s default over the sport-wide default', async () => {
    primeLeagueMocks(true);

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('contest-template-lpga-tiered-pick-12')).toBeChecked());
    const queries = listContestConfigTemplatesMock.mock.calls.map(([options]) =>
      (options as { query?: { sport?: string; sportLeagueId?: string } }).query);
    expect(queries).toContainEqual(expect.objectContaining({ sport: 'GOLF', sportLeagueId: LPGA_LEAGUE_ID }));
    expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).not.toBeChecked();
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(8);
  });

  it('starts on the sport-wide default when the event\'s league has presets but no default of its own', async () => {
    primeLeagueMocks(false);

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toBeChecked());
    expect(screen.getByTestId('contest-template-lpga-tiered-pick-12')).not.toBeChecked();
  });
});

describe('Commissioner tools › Contests › Create contest › Budget format (#93)', () => {
  const PRICING = { profileName: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
  const BUDGET_TEMPLATE = {
    id: '55555555-5555-4555-8555-555555555555',
    sport: 'GOLF',
    contestFormat: 'ROSTER',
    selectionType: 'BUDGET_PICK',
    templateKey: 'golf-budget-pick-6',
    name: 'Pick 6 under the cap, 4 count',
    description: 'Default golf budget template',
    sortOrder: 3,
    isDefault: true,
    active: true,
    schemaVersion: 1,
    configuration: { maxEntriesPerSquad: 1, selectionType: 'BUDGET_PICK', rosterSize: 6, countedScores: 4 },
  };

  /** The common mocks with the budget preset added and the one event priced, or not. */
  async function primeBudgetMocks(pricing: typeof PRICING | null) {
    primeCommonMocks();
    listEventsMock.mockResolvedValue(singleEvent({ pricing }));
    const { data } = await (listContestConfigTemplatesMock.getMockImplementation()?.() as Promise<{ data: { templates: unknown[] } }>);
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [...data.templates, BUDGET_TEMPLATE] } });
  }

  afterEach(() => {
    createContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
  });

  it('keeps Budget unavailable and says why while the event\'s golfers have no prices', async () => {
    await primeBudgetMocks(null);

    renderCreateContestPage();

    await waitForStartingChoices();
    const budget = screen.getByTestId('contest-format-BUDGET_PICK');
    expect(budget).toBeDisabled();
    expect(budget).toHaveTextContent('This event’s golfers have no prices yet.');
    fireEvent.click(budget);
    expect(screen.getByTestId('contest-format-TIERED')).toBeChecked();
  });

  it('switches to Budget with its default preset, shows the event\'s cap read-only, and creates budget rules', async () => {
    await primeBudgetMocks(PRICING);
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-budget' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-format-BUDGET_PICK'));

    expect(screen.getByTestId('contest-format-BUDGET_PICK')).toBeChecked();
    expect(screen.getByTestId('contest-template-golf-budget-pick-6')).toBeChecked();
    expect(screen.queryByTestId('contest-template-golf-tiered-pick-6')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-budget-roster-size')).toHaveValue(6);
    expect(screen.getByTestId('contest-budget-counted-scores')).toHaveValue(4);
    expect(screen.getByTestId('contest-budget-salary-cap')).toHaveTextContent('$50,000 salary cap');
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Budget Pick 6'));
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent(
      'Pick 6 golfers whose prices fit under the $50,000 salary cap. The best 4 scores count. 1 entry per member.',
    );

    fireEvent.change(screen.getByTestId('contest-budget-roster-size'), { target: { value: '5' } });
    expect(screen.getByTestId('contest-template-custom')).toBeChecked();
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toEqual({
      name: 'Masters Tournament Budget Pick 5',
      sportEventIds: ['event-1'],
      contestFormat: 'ROSTER',
      selectionType: 'BUDGET_PICK',
      configuration: { selectionType: 'BUDGET_PICK', rosterSize: 5, countedScores: 4, maxEntriesPerSquad: 1 },
    });
  });

  it('says in plain words when even the cheapest picks for every place cost more than the cap', async () => {
    await primeBudgetMocks(PRICING);
    createContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_BUDGET_UNFILLABLE', message: 'Budget rules cannot be filled.' } },
    });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-format-BUDGET_PICK'));
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByText(
      'Even the cheapest picks for every place cost more than the salary cap, so nobody could enter. Pick fewer per entry.',
    )).toBeInTheDocument();
  });
});

describe('Commissioner tools › Contests › Create contest › Random draw format', () => {
  const DRAW_TEMPLATES = [
    {
      id: '66666666-6666-4666-8666-666666666666',
      sport: 'GOLF',
      contestFormat: 'ROSTER',
      selectionType: 'RANDOM_DRAW',
      templateKey: 'golf-random-draw-1',
      name: 'Draw 1 golfer each',
      description: 'Golf sweepstake',
      sortOrder: 5,
      isDefault: false,
      active: true,
      schemaVersion: 1,
      configuration: { maxEntriesPerSquad: 1, selectionType: 'RANDOM_DRAW', picksPerEntry: 1, countedScores: 1 },
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      sport: 'GOLF',
      contestFormat: 'ROSTER',
      selectionType: 'RANDOM_DRAW',
      templateKey: 'golf-random-draw-3-best-2',
      name: 'Draw 3 golfers each, 2 count',
      description: 'Golf sweepstake, best two of three',
      sortOrder: 6,
      isDefault: false,
      active: true,
      schemaVersion: 1,
      configuration: { maxEntriesPerSquad: 1, selectionType: 'RANDOM_DRAW', picksPerEntry: 3, countedScores: 2 },
    },
  ];

  async function primeDrawMocks() {
    primeCommonMocks();
    const { data } = await (listContestConfigTemplatesMock.getMockImplementation()?.() as Promise<{ data: { templates: unknown[] } }>);
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [...data.templates, ...DRAW_TEMPLATES] } });
  }

  afterEach(() => {
    createContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
  });

  it('switches to Random draw with its sweepstake presets, and creates random-draw rules with golfers dealt per entry', async () => {
    await primeDrawMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-draw' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-format-RANDOM_DRAW'));

    expect(screen.getByTestId('contest-format-RANDOM_DRAW')).toHaveTextContent('Random draw');
    expect(screen.getByTestId('contest-template-golf-random-draw-1')).toBeChecked();
    expect(screen.getByTestId('contest-template-golf-random-draw-1')).toHaveAccessibleName('Draw 1, all count');
    expect(screen.getByTestId('contest-template-golf-random-draw-3-best-2')).toHaveAccessibleName('Draw 3, best 2');
    expect(screen.getByLabelText('Golfers per entry')).toHaveValue(1);

    fireEvent.click(screen.getByTestId('contest-template-golf-random-draw-3-best-2'));
    expect(screen.getByLabelText('Golfers per entry')).toHaveValue(3);
    expect(screen.getByLabelText('Scores that count')).toHaveValue(2);
    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Sweepstake'));
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent(
      'The draw deals each entry 3 golfers at random. The best 2 scores count. 1 entry per member.',
    );

    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toEqual({
      name: 'Masters Tournament Sweepstake',
      sportEventIds: ['event-1'],
      contestFormat: 'ROSTER',
      selectionType: 'RANDOM_DRAW',
      templateId: '77777777-7777-4777-8777-777777777777',
      configuration: { selectionType: 'RANDOM_DRAW', picksPerEntry: 3, countedScores: 2, maxEntriesPerSquad: 1 },
    });
  });

  it('keeps Create contest disabled and says why when more scores count than the draw deals each entry', async () => {
    await primeDrawMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-format-RANDOM_DRAW'));
    fireEvent.change(screen.getByLabelText('Scores that count'), { target: { value: '2' } });

    expect(screen.getByTestId('contest-rules-error')).toHaveTextContent('Scores that count must be between 1 and the 1 golfer dealt.');
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();
  });
});

describe('Commissioner tools › Contests › Create contest for a horse race', () => {
  const RACE_PRESET_ID = '77777777-0000-4000-8000-000000000001';

  /** Golf's catalog as before, and one released race with its Win / Place / Show preset. */
  function primeRacingMocks() {
    primeCommonMocks();
    const golfEvents: ((options: unknown) => unknown) | undefined = listEventsMock.getMockImplementation();
    const golfTemplates: ((options: unknown) => unknown) | undefined = listContestConfigTemplatesMock.getMockImplementation();
    listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => (
      options.query?.sport === 'HORSE_RACING'
        ? singleEvent({ id: 'race-1', sport: 'HORSE_RACING', name: 'Kentucky Derby', participantCount: 9, tierCount: 3 })
        : golfEvents?.(options)
    ));
    listContestConfigTemplatesMock.mockImplementation((options: { query?: { sport?: string } }) => (
      options.query?.sport === 'HORSE_RACING'
        ? {
          data: {
            templates: [{
              id: RACE_PRESET_ID,
              sport: 'HORSE_RACING',
              contestFormat: 'ROSTER',
              selectionType: 'TIERED',
              templateKey: 'horse-racing-tiered-pick-3',
              name: 'One horse from each tier, all count',
              description: 'Win / Place / Show',
              sortOrder: 1,
              isDefault: true,
              active: true,
              schemaVersion: 1,
              configuration: {
                maxEntriesPerSquad: 1,
                selectionType: 'TIERED',
                picksPerTier: 1,
                countedScores: 3,
                scoring: {
                  participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
                  config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 },
                },
              },
            }],
          },
        }
        : golfTemplates?.(options)
    ));
  }

  afterEach(() => {
    createContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
  });

  it('offers one sport choice per supported sport and shows no points table for golf, which takes no scoring settings', async () => {
    primeRacingMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    expect(screen.getByTestId('contest-sport-GOLF')).toBeChecked();
    expect(screen.getByTestId('contest-sport-HORSE_RACING')).toHaveTextContent('Horse racing');
    expect(screen.queryByTestId('contest-scoring-points-table')).not.toBeInTheDocument();
  });

  it('lists the races on choosing horse racing, starts from its preset\'s points table, and sends that table as the contest\'s scoring', async () => {
    primeRacingMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-race' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-sport-HORSE_RACING'));

    await waitFor(() => expect(screen.getByTestId('contest-event-race-1')).toBeChecked());
    expect(screen.getByTestId('contest-event-race-1')).toHaveTextContent('9 horses · 3 tiers');
    await waitFor(() => expect(screen.getByTestId('contest-template-horse-racing-tiered-pick-3')).toBeChecked());
    expect(screen.getByTestId('contest-scoring-points-table')).toHaveValue('5, 3, 1');
    expect(screen.getByTestId('contest-scoring-did-not-finish-points')).toHaveValue(0);
    expect(screen.getByTestId('create-contest-event')).toHaveTextContent('Entries close at the post time.');
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent(
      'Pick 1 horse from each of 3 tiers. Every score counts. Points by finishing place: 5, 3, 1. 1 entry per member.',
    );

    fireEvent.change(screen.getByTestId('contest-scoring-points-table'), { target: { value: '10, 6, 4, 2' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toEqual({
      name: 'Kentucky Derby Pick 3',
      sportEventIds: ['race-1'],
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      configuration: {
        selectionType: 'TIERED',
        picksPerTier: 1,
        countedScores: 3,
        maxEntriesPerSquad: 1,
        scoring: {
          participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
          config: { pointsTable: [10, 6, 4, 2], didNotFinishPoints: 0 },
        },
      },
    });
  });

  it('keeps Create contest disabled with the shared rule\'s reason when a worse place would score more than a better one', async () => {
    primeRacingMocks();

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-sport-HORSE_RACING'));
    await waitFor(() => expect(screen.getByTestId('contest-scoring-points-table')).toHaveValue('5, 3, 1'));

    fireEvent.change(screen.getByTestId('contest-scoring-points-table'), { target: { value: '3, 5, 1' } });

    expect(screen.getByTestId('contest-scoring-error')).toHaveTextContent(
      'A better finishing place cannot score fewer points than a worse one.',
    );
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('contest-scoring-points-table'), { target: { value: 'win, place' } });
    expect(screen.getByTestId('contest-scoring-error')).toHaveTextContent('Enter the points table as whole numbers');
    expect(createContestMock).not.toHaveBeenCalled();
  });
});

describe('Commissioner tools › Contests › Create contest for a Formula 1 race', () => {
  const FORMULA_1_LEAGUE_ID = '62500000-0000-4000-8000-000000000001';
  const PRICING = { profileName: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
  const FORMULA_1_SCORING = {
    participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
    config: { pointsTable: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], didNotFinishPoints: 0 },
  };
  const formula1Preset = (
    id: string,
    templateKey: string,
    sortOrder: number,
    isDefault: boolean,
    configuration: { selectionType: string; [setting: string]: unknown },
  ) => ({
    id,
    sport: 'AUTO_RACING',
    sportLeagueId: FORMULA_1_LEAGUE_ID,
    contestFormat: 'ROSTER',
    selectionType: configuration.selectionType,
    templateKey,
    name: templateKey,
    description: 'Formula 1 points',
    sortOrder,
    isDefault,
    active: true,
    schemaVersion: 1,
    configuration: { maxEntriesPerSquad: 1, ...configuration, scoring: FORMULA_1_SCORING },
  });
  // The series' presets as the migration seeds them: budget is the default and sorts first.
  const FORMULA_1_PRESETS = [
    formula1Preset('62500000-0000-4000-8000-000000000011', 'formula-1-budget-points', 1, true,
      { selectionType: 'BUDGET_PICK', rosterSize: 5, countedScores: 5 }),
    formula1Preset('62500000-0000-4000-8000-000000000012', 'formula-1-tiered-points', 2, false,
      { selectionType: 'TIERED', picksPerTier: 1, countedScores: 4 }),
    formula1Preset('62500000-0000-4000-8000-000000000013', 'formula-1-random-draw-points', 3, false,
      { selectionType: 'RANDOM_DRAW', picksPerEntry: 1, countedScores: 1 }),
  ];

  /** Golf's catalog as before, and one released Formula 1 race, priced or not, set to 4 tiers. */
  function primeFormula1Mocks(pricing: typeof PRICING | null) {
    primeCommonMocks();
    const golfEvents: ((options: unknown) => unknown) | undefined = listEventsMock.getMockImplementation();
    const golfTemplates: ((options: unknown) => unknown) | undefined = listContestConfigTemplatesMock.getMockImplementation();
    listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => (
      options.query?.sport === 'AUTO_RACING'
        ? singleEvent({
          id: 'f1-race-1',
          sport: 'AUTO_RACING',
          sportLeagueId: FORMULA_1_LEAGUE_ID,
          name: 'Monaco Grand Prix',
          participantCount: 22,
          tierCount: 4,
          pricing,
        })
        : golfEvents?.(options)
    ));
    listContestConfigTemplatesMock.mockImplementation((options: { query?: { sport?: string; sportLeagueId?: string } }) => (
      options.query?.sport === 'AUTO_RACING'
        ? { data: { templates: options.query.sportLeagueId === FORMULA_1_LEAGUE_ID ? FORMULA_1_PRESETS : [] } }
        : golfTemplates?.(options)
    ));
  }

  afterEach(() => {
    createContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
  });

  it('starts a Formula 1 race on Budget with the series\' default budget preset and its F1 points table, not on Tiered', async () => {
    primeFormula1Mocks(PRICING);
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-f1' } } });

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-sport-AUTO_RACING'));

    await waitFor(() => expect(screen.getByTestId('contest-event-f1-race-1')).toBeChecked());
    await waitFor(() => expect(screen.getByTestId('contest-template-formula-1-budget-points')).toBeChecked());
    expect(screen.getByTestId('contest-format-BUDGET_PICK')).toBeChecked();
    expect(screen.getByTestId('contest-format-TIERED')).not.toBeChecked();
    expect(screen.getByTestId('contest-budget-roster-size')).toHaveValue(5);
    expect(screen.getByTestId('contest-budget-counted-scores')).toHaveValue(5);
    expect(screen.getByTestId('contest-scoring-points-table')).toHaveValue('25, 18, 15, 12, 10, 8, 6, 4, 2, 1');

    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toMatchObject({
      sportEventIds: ['f1-race-1'],
      selectionType: 'BUDGET_PICK',
      templateId: '62500000-0000-4000-8000-000000000011',
    });
  });

  it('starts a Formula 1 race that has no prices yet on Tiered with the series\' tiered preset, since Budget is unavailable', async () => {
    primeFormula1Mocks(null);

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-sport-AUTO_RACING'));

    await waitFor(() => expect(screen.getByTestId('contest-template-formula-1-tiered-points')).toBeChecked());
    expect(screen.getByTestId('contest-format-TIERED')).toBeChecked();
    expect(screen.getByTestId('contest-format-BUDGET_PICK')).toBeDisabled();
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(4);
  });

  it('switches to each series\' own default format when the commissioner moves between a NASCAR race and a Formula 1 race', async () => {
    const NASCAR_LEAGUE_ID = '62400000-0000-4000-8000-000000000001';
    primeFormula1Mocks(PRICING);
    const [f1Race] = (singleEvent({
      id: 'f1-race-1',
      sport: 'AUTO_RACING',
      sportLeagueId: FORMULA_1_LEAGUE_ID,
      name: 'Monaco Grand Prix',
      startDate: '2099-05-30T13:00:00.000Z',
      participantCount: 22,
      tierCount: 4,
      pricing: PRICING,
    }).data.events);
    const [nascarRace] = (singleEvent({
      id: 'nascar-race-1',
      sport: 'AUTO_RACING',
      sportLeagueId: NASCAR_LEAGUE_ID,
      name: 'Daytona 500',
      startDate: '2099-02-21T19:30:00.000Z',
      participantCount: 40,
      tierCount: 5,
      pricing: PRICING,
    }).data.events);
    const nascarTiered = {
      ...formula1Preset('62400000-0000-4000-8000-000000000011', 'nascar-cup-tiered-points', 1, true,
        { selectionType: 'TIERED', picksPerTier: 1, countedScores: 5 }),
      sportLeagueId: NASCAR_LEAGUE_ID,
    };
    const golfEvents: ((options: unknown) => unknown) | undefined = listEventsMock.getMockImplementation();
    const f1Templates: ((options: unknown) => unknown) | undefined = listContestConfigTemplatesMock.getMockImplementation();
    listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => (
      options.query?.sport === 'AUTO_RACING' ? { data: { events: [nascarRace, f1Race] } } : golfEvents?.(options)
    ));
    listContestConfigTemplatesMock.mockImplementation((options: { query?: { sport?: string; sportLeagueId?: string } }) => (
      options.query?.sportLeagueId === NASCAR_LEAGUE_ID ? { data: { templates: [nascarTiered] } } : f1Templates?.(options)
    ));

    renderCreateContestPage();

    await waitForStartingChoices();
    fireEvent.click(screen.getByTestId('contest-sport-AUTO_RACING'));
    await waitFor(() => expect(screen.getByTestId('contest-template-nascar-cup-tiered-points')).toBeChecked());
    expect(screen.getByTestId('contest-format-TIERED')).toBeChecked();

    fireEvent.click(screen.getByTestId('contest-event-f1-race-1'));
    await waitFor(() => expect(screen.getByTestId('contest-template-formula-1-budget-points')).toBeChecked());
    expect(screen.getByTestId('contest-format-BUDGET_PICK')).toBeChecked();

    fireEvent.click(screen.getByTestId('contest-event-nascar-race-1'));
    await waitFor(() => expect(screen.getByTestId('contest-template-nascar-cup-tiered-points')).toBeChecked());
    expect(screen.getByTestId('contest-format-TIERED')).toBeChecked();
  });
});

describe('Commissioner tools › Contests › Create contest › Squares format', () => {
  /** The NFL playoffs under way: the Super Bowl to come, a conference game to come, a divisional game played. */
  const PLAYOFFS_UNDER_WAY = {
    id: 'nfl-playoffs',
    sport: 'AMERICAN_FOOTBALL',
    name: 'NFL Playoffs',
    venue: null,
    status: 'IN_PROGRESS',
    startDate: '2099-01-10T18:00:00.000Z',
    participantCount: 14,
    readinessStatus: 'EVENT_STARTED',
    readinessReasons: ['EVENT_STARTED'],
    contestEligible: false,
    tierCount: 0,
    rounds: 4,
    sportLeagueId: 'nfl',
  };
  const game = (overrides: Record<string, unknown>) => ({
    sportEventId: 'nfl-playoffs',
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
    isNeutralSite: false,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    advancesToMatchId: 'game-sb',
    advancesToSide: 'HOME',
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  });

  function primeFootballMocks() {
    primeCommonMocks();
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'nfl', name: 'NFL', roundNames: ['Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl'] } } });
    const golfEvents = listEventsMock.getMockImplementation() as ((options: unknown) => Promise<unknown>) | undefined;
    listEventsMock.mockImplementation((options: { query?: { sport?: string } }): Promise<unknown> => (options.query?.sport === 'AMERICAN_FOOTBALL'
      ? Promise.resolve({ data: { events: [PLAYOFFS_UNDER_WAY] } })
      : golfEvents?.(options) ?? Promise.resolve({ data: { events: [] } })));
    const golfTemplates = listContestConfigTemplatesMock.getMockImplementation() as ((options: unknown) => Promise<unknown>) | undefined;
    listContestConfigTemplatesMock.mockImplementation((options: { query?: { sport?: string } }): Promise<unknown> => (options.query?.sport === 'AMERICAN_FOOTBALL'
      ? Promise.resolve({ data: { templates: [] } })
      : golfTemplates?.(options) ?? Promise.resolve({ data: { templates: [] } })));
    getEventBracketMock.mockResolvedValue({
      data: {
        matches: [
          game({ id: 'game-div', roundNumber: 2, matchNumber: 9, status: 'COMPLETED', scheduledDate: '2099-01-17T21:00:00.000Z', homeScore: 31, awayScore: 17 }),
          game({ id: 'game-afc', roundNumber: 3, matchNumber: 11, scheduledDate: '2099-01-25T20:00:00.000Z', homeSportEventParticipantId: 'field-chiefs', awaySportEventParticipantId: 'field-bills' }),
          game({ id: 'game-sb', roundNumber: 4, matchNumber: 13, isNeutralSite: true, scheduledDate: '2099-02-07T23:30:00.000Z', advancesToMatchId: null, advancesToSide: null }),
        ],
      },
    });
    listEventParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          { id: 'field-chiefs', participant: { name: 'Kansas City Chiefs' } },
          { id: 'field-bills', participant: { name: 'Buffalo Bills' } },
        ],
      },
    });
  }

  afterEach(() => {
    for (const mock of [
      createContestMock, getEventBracketMock, getLeagueByCodeMock, getSportLeagueMock,
      listContestConfigTemplatesMock, listEventParticipantsMock, listEventsMock,
    ]) {
      mock.mockReset();
    }
  });

  it('lists the playoffs under way for squares, offers its games still to kick off with the Super Bowl first, takes one entry per member, and creates the contest on the chosen game', async () => {
    primeFootballMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-squares' } } });
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-AMERICAN_FOOTBALL'));
    fireEvent.click(await screen.findByTestId('contest-format-SQUARES'));
    await waitFor(() => expect(screen.getByTestId('contest-event-nfl-playoffs')).toBeChecked());

    const picker = await screen.findByTestId('contest-squares-game');
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Super Bowl · To be decided vs To be decided'),
      expect.stringContaining('Conference Championship · Buffalo Bills @ Kansas City Chiefs'),
    ]);
    await waitFor(() => expect(picker).toHaveValue('game-sb'));
    expect(screen.getByTestId('contest-squares-boxes-per-entry')).toHaveValue(10);
    expect(screen.getByTestId('contest-squares-one-entry')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-max-entries')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-scoring-round-values')).not.toBeInTheDocument();

    fireEvent.change(picker, { target: { value: 'game-afc' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    expect(submittedBody()).toMatchObject({
      sportEventIds: ['nfl-playoffs'],
      contestFormat: 'SQUARES',
      selectionType: 'SQUARES',
      sportEventMatchId: 'game-afc',
      configuration: { selectionType: 'SQUARES', maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 },
    });
  });
});

describe('Commissioner tools › Contests › Create contest › templates by name and kind of event', () => {
  const NFL_WEEK = {
    id: 'nfl-week-1',
    sport: 'AMERICAN_FOOTBALL',
    name: 'NFL Week 1',
    venue: null,
    status: 'SCHEDULED',
    startDate: '2099-09-10T17:00:00.000Z',
    participantCount: 32,
    readinessStatus: 'CONTEST_ELIGIBLE',
    readinessReasons: [],
    contestEligible: true,
    tierCount: 0,
    rounds: 1,
    sportLeagueId: 'nfl',
  };
  const nflTemplate = (overrides: Record<string, unknown>) => ({
    sport: 'AMERICAN_FOOTBALL',
    sportLeagueId: 'nfl',
    active: true,
    schemaVersion: 1,
    ...overrides,
  });
  const WEEK_TEMPLATES = [
    nflTemplate({
      id: '80200000-0000-4000-8000-000000000001',
      eventType: 'WEEK',
      contestFormat: 'PREDICTION',
      selectionType: 'PICK_EM',
      templateKey: 'nfl-pick-em-straight-up',
      name: 'Pick’em: every game, straight up',
      description: 'Pick the winner of every game each week. Every right pick scores a point.',
      sortOrder: 1,
      isDefault: true,
      configuration: { selectionType: 'PICK_EM', mode: 'STRAIGHT_UP', againstTheSpread: false, maxEntriesPerSquad: 1 },
    }),
    nflTemplate({
      id: '80200000-0000-4000-8000-000000000002',
      eventType: 'WEEK',
      contestFormat: 'PREDICTION',
      selectionType: 'SURVIVOR',
      templateKey: 'nfl-survivor',
      name: 'Survivor: 1 team a week, each team once',
      description: 'Pick one team to win each week, never the same team twice. A loss puts the entry out.',
      sortOrder: 4,
      isDefault: true,
      configuration: { selectionType: 'SURVIVOR', maxEntriesPerSquad: 1 },
    }),
  ];
  const KNOCKOUT_TEMPLATES = [
    nflTemplate({
      id: '80200000-0000-4000-8000-000000000003',
      eventType: 'KNOCKOUT',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      templateKey: 'nfl-tiered-doubling',
      name: 'Tiered: 1 team per tier, doubling points',
      description: 'Pick one team from each tier. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.',
      sortOrder: 1,
      isDefault: true,
      configuration: {
        selectionType: 'TIERED',
        picksPerTier: 1,
        countedScores: 7,
        maxEntriesPerSquad: 1,
        scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' } } },
      },
    }),
  ];

  /** One NFL week to set a contest up on; the template list answers by the kind of event asked for. */
  function primeNflWeekMocks() {
    primeCommonMocks();
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'nfl', name: 'NFL', roundNames: [] } } });
    const golfEvents = listEventsMock.getMockImplementation() as ((options: unknown) => Promise<unknown>) | undefined;
    listEventsMock.mockImplementation((options: { query?: { sport?: string } }): Promise<unknown> => (options.query?.sport === 'AMERICAN_FOOTBALL'
      ? Promise.resolve({ data: { events: [NFL_WEEK] } })
      : golfEvents?.(options) ?? Promise.resolve({ data: { events: [] } })));
    const golfTemplates = listContestConfigTemplatesMock.getMockImplementation() as ((options: unknown) => Promise<unknown>) | undefined;
    listContestConfigTemplatesMock.mockImplementation((options: { query?: { sport?: string; eventType?: string } }): Promise<unknown> => {
      if (options.query?.sport !== 'AMERICAN_FOOTBALL') {
        return golfTemplates?.(options) ?? Promise.resolve({ data: { templates: [] } });
      }
      return Promise.resolve({ data: { templates: options.query.eventType === 'WEEK' ? WEEK_TEMPLATES : KNOCKOUT_TEMPLATES } });
    });
  }

  afterEach(() => {
    for (const mock of [
      createContestMock, getEventBracketMock, getLeagueByCodeMock, getSportLeagueMock,
      listContestConfigTemplatesMock, listEventParticipantsMock, listEventsMock,
    ]) {
      mock.mockReset();
    }
  });

  it('shows each template as a choice by its name, with its description under it', async () => {
    primeCommonMocks();
    renderCreateContestPage();
    await waitForStartingChoices();

    expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toHaveTextContent('Select one from each tier, 4 count');
    expect(screen.getByTestId('contest-template-golf-tiered-pick-6')).toHaveTextContent('Default golf tiered template');
    expect(screen.getByTestId('contest-template-golf-tiered-pick-12')).toHaveTextContent('Pick two golfers from each seeded tier.');
  });

  it('asks for a week\'s templates on an NFL week, starts it on the NFL\'s Pick\'em default, and offers survivor\'s default on switching', async () => {
    primeNflWeekMocks();
    renderCreateContestPage();
    await waitForStartingChoices();

    fireEvent.click(screen.getByTestId('contest-sport-AMERICAN_FOOTBALL'));

    await waitFor(() => expect(screen.getByTestId('contest-template-nfl-pick-em-straight-up')).toBeChecked());
    expect(screen.getByTestId('contest-format-PICK_EM')).toBeChecked();
    const queries = listContestConfigTemplatesMock.mock.calls.map(([options]) =>
      (options as { query?: Record<string, unknown> }).query);
    expect(queries).toContainEqual(expect.objectContaining({ sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'nfl', eventType: 'WEEK' }));
    expect(screen.queryByTestId('contest-template-nfl-tiered-doubling')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-format-SURVIVOR'));

    await waitFor(() => expect(screen.getByTestId('contest-template-nfl-survivor')).toBeChecked());
  });
});
