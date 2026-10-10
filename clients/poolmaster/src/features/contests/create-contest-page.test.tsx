import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { CreateContestPage } from './create-contest-page';

const {
  createContestMock,
  getLeagueByCodeMock,
  listContestConfigTemplatesMock,
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
    getLeagueByCodeMock: vi.fn(),
    listContestConfigTemplatesMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createContest: createContestMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContestConfigTemplates: listContestConfigTemplatesMock,
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
      'Masters Tournament Pick 6 · Masters TournamentPick 1 golfer from each of 6 tiers. The best 4 scores count. 1 entry per team.',
    );
    expect(screen.getByTestId('create-contest-submit')).toHaveTextContent('Create contest');
  });

  it('creates the contest from the chosen event, preset and rules, then lands on the new contest\'s page', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-90' } } });

    renderCreateContestPage();

    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Pick 6'));
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByTestId('admin-contest-destination')).toHaveTextContent('contest-90');
    expect(createContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
    expect(submittedBody()).toEqual({
      name: 'Masters Tournament Pick 6',
      sportEventId: 'event-1',
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
    expect(screen.getByTestId('contest-members-will-see')).toHaveTextContent('The best 5 scores count. No limit on entries per team.');
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

  it('keeps a selected preset\'s own scores that count when the event\'s tiers load', async () => {
    primeCommonMocks();
    listContestConfigTemplatesMock.mockResolvedValue({
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

    // The events (and so the tier count) arrive after the preset has been applied.
    let releaseEvents: (value: unknown) => void = () => undefined;
    listEventsMock.mockReturnValue(new Promise((resolve) => { releaseEvents = resolve; }));

    renderCreateContestPage();

    await waitFor(() => expect(listContestConfigTemplatesMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    releaseEvents(singleEvent());

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

    await waitFor(() => expect(screen.getByTestId('contest-name')).toHaveValue('Masters Tournament Pick 6'));
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
