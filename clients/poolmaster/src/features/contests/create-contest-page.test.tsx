import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { CreateContestPage } from './create-contest-page';

const {
  createContestMock,
  deleteContestMock,
  getLeagueByCodeMock,
  getContestConfigurationMock,
  listContestConfigTemplatesMock,
  listEventsMock,
  mockLogger,
  openContestMock,
  updateContestMock,
  updateContestConfigurationMock,
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
    deleteContestMock: vi.fn(),
    getLeagueByCodeMock: vi.fn(),
    getContestConfigurationMock: vi.fn(),
    listContestConfigTemplatesMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger: logger,
    openContestMock: vi.fn(),
    updateContestMock: vi.fn(),
    updateContestConfigurationMock: vi.fn(),
  };
});

bindApiMocks({
  createContest: createContestMock,
  deleteContest: deleteContestMock,
  getLeagueByCode: getLeagueByCodeMock,
  getContestConfiguration: getContestConfigurationMock,
  listContestConfigTemplates: listContestConfigTemplatesMock,
  listEvents: listEventsMock,
  openContest: openContestMock,
  updateContest: updateContestMock,
  updateContestConfiguration: updateContestConfigurationMock,
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

function renderCreateContestPage() {
  return renderContestPage('/league/BIGDAWGS/contests/new');
}

function renderContestPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<CreateContestPage />} path="/league/:leagueCode/contests/new" />
          <Route element={<CreateContestPage />} path="/league/:leagueCode/contests/:contestId/manage" />
          <Route
            element={<div data-testid="contest-detail-page" />}
            path="/league/:leagueCode/contests/:contestId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildManagedContest(status: string, overrides: { id?: string } = {}) {
  const id = overrides.id ?? 'contest-90';
  return {
    id,
    leagueId: 'league-1',
    sportEventId: 'event-1',
    name: 'Masters Pick 6',
    status,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    configuration: {
      id: `config-${id}`,
      contestId: id,
      maxEntriesPerSquad: 1,
      picksPerTier: 1,
      countedScores: 4,
    },
    effectiveTiers: [],
  };
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
        joinPolicy: 'COMMISSIONER_ONLY',
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
          id: 'event-1',
          sport: 'GOLF',
          name: 'Masters Tournament',
          status: 'SCHEDULED',
          startDate: '2026-04-10T12:00:00.000Z',
          participantCount: 144,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
          tierCount: 6,
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
            picksPerTier: 2,
            countedScores: 8,
          },
        },
      ],
    },
  });
}

describe('CreateContestPage', () => {
  afterEach(() => {
    createContestMock.mockReset();
    deleteContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    getContestConfigurationMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
    openContestMock.mockReset();
    updateContestMock.mockReset();
    updateContestConfigurationMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('submits the commissioner golf tiered contest payload', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-1',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 6' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(createContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        body: expect.objectContaining({
          name: 'Masters Pick 6',
          sportEventId: 'event-1',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          templateId: '11111111-1111-4111-8111-111111111111',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
          configuration: expect.objectContaining({
            picksPerTier: 1,
            countedScores: 4,
          }),
        }),
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contest.create.succeeded',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        data: expect.objectContaining({
          contestId: 'contest-1',
        }),
      }),
      expect.any(String),
    );
  });

  it('offers no lock-time setting and sends no lock time, because entries close when the event starts', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-1' } } });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    expect(screen.queryByTestId('contest-lock-preset')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 6' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalled());
    const [request] = createContestMock.mock.calls[0] as [{ body: { configuration: Record<string, unknown> } }];
    expect(request.body.configuration).not.toHaveProperty('locksAt');
  });

  it('pool-master-7wj.6 shows setup validation before submitting an unnamed contest', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByTestId('create-contest-error')).toHaveTextContent(
      'Contest name is required.',
    );
    expect(createContestMock).not.toHaveBeenCalled();
  });

  // pool-master-dxd.39 — pick-12 templates seed the wider roster shape.
  it('applies the pick-12 template: two picks per tier on six tiers is twelve golfers, eight counting', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-12',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.click(screen.getByTestId('contest-template-golf-tiered-pick-12'));

    expect(screen.getByTestId('contest-tiered-picks-per-tier')).toHaveValue(2);
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(8);
    expect(screen.getByText('6 tiers × 2 = 12 golfers picked.')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 12' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(createContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        body: expect.objectContaining({
          templateId: '33333333-3333-4333-8333-333333333333',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
          configuration: expect.objectContaining({
            picksPerTier: 2,
            countedScores: 8,
          }),
        }),
      }),
    );
  });

  it('resets scores that count to all but two tiers\' worth when picks per tier changes', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    expect(screen.getByText('6 tiers × 1 = 6 golfers picked.')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), {
      target: { value: '2' },
    });

    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(8);
    expect(screen.getByText('6 tiers × 2 = 12 golfers picked.')).toBeInTheDocument();
  });

  it('keeps a selected template\'s own scores that count when the event\'s tiers load', async () => {
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
            configuration: { maxEntriesPerSquad: 1, picksPerTier: 2, countedScores: 10 },
          },
        ],
      },
    });

    // The events (and so the tier count) arrive after the template has been applied.
    const primedEvents = await (listEventsMock.getMockImplementation()?.() as Promise<unknown>);
    let releaseEvents: (value: unknown) => void = () => undefined;
    listEventsMock.mockReturnValue(new Promise((resolve) => { releaseEvents = resolve; }));

    renderCreateContestPage();

    await waitFor(() => expect(listContestConfigTemplatesMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    releaseEvents(primedEvents);

    await screen.findByText('6 tiers × 2 = 12 golfers picked.');
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(10);
  });

  it('starts scores that count at the selected event\'s tier count less two', async () => {
    primeCommonMocks();
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [] } });
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-1',
            sport: 'GOLF',
            name: 'Masters Tournament',
            status: 'SCHEDULED',
            startDate: '2026-04-10T12:00:00.000Z',
            participantCount: 144,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
            tierCount: 4,
          },
        ],
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    await waitFor(() => expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(2));
    expect(screen.getByText('4 tiers × 1 = 4 golfers picked.')).toBeInTheDocument();
  });

  // #245 — a template is optional: with none, the complete form configuration is the contest's.
  it('creates a contest from the form configuration alone when no template is offered', async () => {
    primeCommonMocks();
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [] } });
    createContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-no-template',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Custom' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() => expect(createContestMock).toHaveBeenCalledTimes(1));
    const [call] = createContestMock.mock.calls[0] as [{ body: Record<string, unknown> }];
    expect(call.body).not.toHaveProperty('templateId');
    expect(call.body).toEqual(
      expect.objectContaining({
        name: 'Masters Custom',
        selectionType: 'TIERED',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        configuration: expect.objectContaining({ picksPerTier: 1, countedScores: 4 }),
      }),
    );
  });

  // #245 client obligation — with neither a template nor a complete configuration, submit stays
  // disabled; the server's CONTEST_CONFIGURATION_REQUIRED is the contract, this is the experience.
  it('keeps submit disabled with no template and an incomplete configuration', async () => {
    primeCommonMocks();
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [] } });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Custom' },
    });
    await waitFor(() => expect(screen.getByTestId('create-contest-submit')).toBeEnabled());

    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), {
      target: { value: '' },
    });
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), {
      target: { value: '7' },
    });
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), {
      target: { value: '6' },
    });
    expect(screen.getByTestId('create-contest-submit')).toBeEnabled();
    expect(createContestMock).not.toHaveBeenCalled();
  });

  // #245 — a selected template never disables submit, even while the form configuration is
  // incomplete (the form's own validation reports that on submit).
  it('keeps submit enabled while a template is selected', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-tiered-picks-per-tier'), {
      target: { value: '' },
    });
    await waitFor(() => expect(screen.getByTestId('create-contest-submit')).toBeEnabled());
  });

  it('shows the rejection message when contest creation is rejected with an expected payload', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({
      error: {
        error: {
          code: 'CONTEST_NAME_IN_USE',
          message: 'Contest name is already in use.',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 6' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await screen.findByText('Contest name is already in use.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contest.create.failed',
      }),
      expect.any(String),
    );
  });

  it('deletes a draft contest from the manage page', async () => {
    primeCommonMocks();
    getContestConfigurationMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-78',
          leagueId: 'league-1',
          sportEventId: 'event-1',
          name: 'Delete Me',
          status: 'DRAFT',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          configuration: {
            id: 'config-78',
            contestId: 'contest-78',
            maxEntriesPerSquad: 1,
            picksPerTier: 1,
            countedScores: 4,
          },
          effectiveTiers: [],
        },
      },
    });
    deleteContestMock.mockResolvedValue({ data: undefined });

    renderContestPage('/league/BIGDAWGS/contests/contest-78/manage');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('contest-delete'));

    await waitFor(() =>
      expect(deleteContestMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-78' },
      }),
    );
  });

  it('shows a no-events-available message when no golf event is contest-ready', async () => {
    primeCommonMocks();
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-1',
            sport: 'GOLF',
            name: 'Masters Tournament',
            status: 'SCHEDULED',
            startDate: '2026-04-10T12:00:00.000Z',
            participantCount: 0,
            readinessStatus: 'PENDING_FIELD',
            readinessReasons: ['FIELD_NOT_LOADED'],
            contestEligible: false,
          },
        ],
      },
    });

    renderCreateContestPage();

    expect(await screen.findByTestId('create-contest-no-events')).toHaveTextContent(
      'No golf events are currently available for contest setup.',
    );
    expect(screen.getByTestId('create-contest-submit')).toBeDisabled();
  });

  it('hydrates and saves the commissioner managed golf contest payload', async () => {
    primeCommonMocks();
    getContestConfigurationMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-77',
          leagueId: 'league-1',
          sportEventId: 'event-1',
          name: 'Masters Pick 6',
          status: 'DRAFT',
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
          configuration: {
            id: 'config-77',
            contestId: 'contest-77',
            maxEntriesPerSquad: 2,
            picksPerTier: 4,
            countedScores: 4,
          },
          effectiveTiers: [
            {
              tierKey: 'tier-1',
              label: 'Tier 1',
              tierNumber: 1,
              assignments: [
                { sportEventParticipantId: 'sep-1', participantId: 'g-1', tierOrderIndex: 1, price: null },
                { sportEventParticipantId: 'sep-2', participantId: 'g-2', tierOrderIndex: 2, price: null },
              ],
            },
          ],
        },
      },
    });
    updateContestMock.mockResolvedValue({ data: { contest: { id: 'contest-77' } } });
    updateContestConfigurationMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-77',
        },
      },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-77/manage');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    expect(screen.getByTestId('contest-name')).toHaveValue('Masters Pick 6');

    // pool-master-41t — manage mode shows the read-only inherited tiers echoed
    // by the managed-contest response (plans/124 §4.6/§5.3).
    expect(screen.getByTestId('inherited-tiers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('inherited-tier-tier-1')).toHaveTextContent(
      '2 golfers',
    );

    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 6 Updated' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(updateContestMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-77' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        body: expect.objectContaining({
          name: 'Masters Pick 6 Updated',
        }),
      }),
    );

    await waitFor(() =>
      expect(updateContestConfigurationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', contestId: 'contest-77' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        body: expect.objectContaining({
          picksPerTier: 4,
          countedScores: 3,
        }),
      }),
    );
  });

  // pool-master-41t — in create mode there is no contest yet, so there are no
  // inherited tiers to echo; the page keeps the plain explanatory note and
  // never renders the read-only tier panel (plans/124 §4.6/§5.3).
  it('does not render the inherited tiers panel in create mode', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    expect(screen.queryByTestId('inherited-tiers-panel')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /This contest uses the tournament’s tiers and golfer assignments/i,
      ),
    ).toBeInTheDocument();
  });

  // pool-master-41t — a failed managed-contest load surfaces the page-level
  // error state rather than a half-rendered manage form.
  it('shows the error state when the managed contest fails to load', async () => {
    primeCommonMocks();
    getContestConfigurationMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Managed contest lookup failed.' } },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-err/manage');

    expect(await screen.findByTestId('create-contest-page-error')).toBeInTheDocument();
    expect(screen.queryByTestId('inherited-tiers-panel')).not.toBeInTheDocument();
  });

  it('lands the commissioner on the new draft\'s setup page, with "Open to league" offered, after create', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-90' } } });
    getContestConfigurationMock.mockResolvedValue({ data: { contest: buildManagedContest('DRAFT') } });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), { target: { value: 'Masters Pick 6' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-detail-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-open-to-league')).toBeInTheDocument();
    expect(screen.getByTestId('contest-delete')).toBeInTheDocument();
  });

  it('opens a draft to the league only after the confirm dialog, then shows the settings as locked', async () => {
    primeCommonMocks();
    getContestConfigurationMock
      .mockResolvedValueOnce({ data: { contest: buildManagedContest('DRAFT') } })
      .mockResolvedValue({ data: { contest: buildManagedContest('OPEN') } });
    openContestMock.mockResolvedValue({ data: { contest: buildManagedContest('OPEN') } });

    renderContestPage('/league/BIGDAWGS/contests/contest-90/manage');

    fireEvent.click(await screen.findByTestId('contest-open-to-league'));
    expect(await screen.findByTestId('contest-open-dialog')).toHaveTextContent(
      /members will be able to see this contest and enter it/i,
    );
    expect(openContestMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('contest-open-confirm'));

    await waitFor(() =>
      expect(openContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1', contestId: 'contest-90' },
      }),
    );
    expect(await screen.findByTestId('contest-manage-readonly-note')).toHaveTextContent(
      'This contest is open to the league, so its settings are locked.',
    );
    expect(screen.queryByTestId('create-contest-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-open-to-league')).not.toBeInTheDocument();
  });

  it('shows the event-started copy in the dialog when opening is refused with CONTEST_EVENT_ALREADY_STARTED', async () => {
    primeCommonMocks();
    getContestConfigurationMock.mockResolvedValue({ data: { contest: buildManagedContest('DRAFT') } });
    openContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_EVENT_ALREADY_STARTED', message: 'server sentence' } },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-90/manage');

    fireEvent.click(await screen.findByTestId('contest-open-to-league'));
    fireEvent.click(await screen.findByTestId('contest-open-confirm'));

    expect(await screen.findByTestId('contest-open-error')).toHaveTextContent(
      'This contest’s event has already started, so it can no longer be opened. Delete the draft instead.',
    );
  });

  // A draft's event is fixed at create: neither update endpoint takes a sport event, so a change
  // made on the setup page would be dropped without a word.
  it('shows a draft\'s own event on its setup page and offers no way to change it', async () => {
    primeCommonMocks();
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-1',
            sport: 'GOLF',
            name: 'Masters Tournament',
            status: 'SCHEDULED',
            startDate: '2026-04-10T12:00:00.000Z',
            participantCount: 144,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
          },
          {
            id: 'event-3',
            sport: 'GOLF',
            name: 'PGA Championship',
            status: 'SCHEDULED',
            startDate: '2026-05-15T12:00:00.000Z',
            participantCount: 156,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
          },
        ],
      },
    });
    getContestConfigurationMock.mockResolvedValue({
      data: { contest: { ...buildManagedContest('DRAFT'), sportEventId: 'event-3' } },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-90/manage');

    expect(await screen.findByTestId('contest-sport-event')).toHaveValue('event-3');
    expect(screen.getByTestId('contest-sport-event')).toBeDisabled();
  });

  it('keeps showing a draft\'s event after it has started, rather than swapping in another event', async () => {
    primeCommonMocks();
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-1',
            sport: 'GOLF',
            name: 'Masters Tournament',
            status: 'SCHEDULED',
            startDate: '2026-04-10T12:00:00.000Z',
            participantCount: 144,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
          },
          {
            id: 'event-2',
            sport: 'GOLF',
            name: 'Players Championship',
            status: 'IN_PROGRESS',
            startDate: '2026-03-12T12:00:00.000Z',
            participantCount: 144,
            readinessStatus: 'EVENT_STARTED',
            readinessReasons: ['EVENT_STARTED'],
            contestEligible: false,
          },
        ],
      },
    });
    getContestConfigurationMock.mockResolvedValue({
      data: { contest: { ...buildManagedContest('DRAFT'), sportEventId: 'event-2' } },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-90/manage');

    expect(await screen.findByTestId('contest-sport-event')).toHaveValue('event-2');
    expect(screen.getByText('Already started')).toBeInTheDocument();
  });

  it('says the contest could not be saved, not created, when a draft edit is refused without a message', async () => {
    primeCommonMocks();
    getContestConfigurationMock.mockResolvedValue({ data: { contest: buildManagedContest('DRAFT') } });
    updateContestMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR' } }, status: 500 });

    renderContestPage('/league/BIGDAWGS/contests/contest-90/manage');

    fireEvent.click(await screen.findByTestId('create-contest-submit'));

    expect(await screen.findByTestId('create-contest-error')).toHaveTextContent(
      'We could not save that contest. Please try again.',
    );
    expect(updateContestConfigurationMock).not.toHaveBeenCalled();
  });

  it('says the contest could not be deleted, not created, when a delete is refused without a message', async () => {
    primeCommonMocks();
    getContestConfigurationMock.mockResolvedValue({ data: { contest: buildManagedContest('DRAFT') } });
    deleteContestMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR' } }, status: 500 });

    renderContestPage('/league/BIGDAWGS/contests/contest-90/manage');

    fireEvent.click(await screen.findByTestId('contest-delete'));

    expect(await screen.findByTestId('create-contest-error')).toHaveTextContent(
      'We could not delete that contest. Please try again.',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contest.delete.failed' }),
      expect.any(String),
    );
  });
});
