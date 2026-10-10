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
    getLeagueByCodeMock.mockReset();
    listContestConfigTemplatesMock.mockReset();
    listEventsMock.mockReset();
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

  it('notes that the contest uses the event\'s own tiers', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    expect(
      screen.getByText(
        /This contest uses the tournament’s tiers and golfer assignments/i,
      ),
    ).toBeInTheDocument();
  });

  it('lands the commissioner on the new contest\'s page in Commissioner tools after create', async () => {
    primeCommonMocks();
    createContestMock.mockResolvedValue({ data: { contest: { id: 'contest-90' } } });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.change(screen.getByTestId('contest-name'), { target: { value: 'Masters Pick 6' } });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByTestId('admin-contest-destination')).toHaveTextContent('contest-90');
  });
});
