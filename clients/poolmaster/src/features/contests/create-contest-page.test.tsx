import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { CreateContestPage } from './create-contest-page';

const {
  createManagedContestMock,
  deleteContestMock,
  getLeagueByCodeMock,
  getManagedContestMock,
  listManagedContestTemplatesMock,
  listEventsMock,
  mockLogger,
  updateContestMock,
  updateManagedContestConfigurationMock,
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
    createManagedContestMock: vi.fn(),
    deleteContestMock: vi.fn(),
    getLeagueByCodeMock: vi.fn(),
    getManagedContestMock: vi.fn(),
    listManagedContestTemplatesMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger: logger,
    updateContestMock: vi.fn(),
    updateManagedContestConfigurationMock: vi.fn(),
  };
});

bindApiMocks({
  createManagedContest: createManagedContestMock,
  deleteContest: deleteContestMock,
  getLeagueByCode: getLeagueByCodeMock,
  getManagedContest: getManagedContestMock,
  listManagedContestTemplates: listManagedContestTemplatesMock,
  listEvents: listEventsMock,
  updateContest: updateContestMock,
  updateManagedContestConfiguration: updateManagedContestConfigurationMock,
});

vi.mock('@/features/auth/auth-provider', () => ({
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
        memberType: 'COMMISSIONER',
        leagueRelationship: {
          leagueMember: true,
          commissioner: true,
        },
        isRootAdmin: false,
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
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
          releaseAt: '2026-04-06T12:00:00.000Z',
          fieldLocksAt: '2026-04-10T11:00:00.000Z',
          participantCount: 144,
          fieldLocked: false,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
        },
      ],
    },
  });
  listManagedContestTemplatesMock.mockResolvedValue({
    data: {
      templates: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          sport: 'GOLF',
          contestFormat: 'ROSTER',
          configMode: 'GOLF_TIERED',
          templateKey: 'golf-tiered-pick-6',
          name: 'Select one from each tier, 4 count',
          description: 'Default golf tiered template',
          sortOrder: 1,
          isDefault: true,
          active: true,
          schemaVersion: 1,
          configuration: {
            mode: 'GOLF_TIERED',
            maxEntriesPerSquad: 1,
            rosterSize: 6,
            countedScores: 4,
          },
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          sport: 'GOLF',
          contestFormat: 'ROSTER',
          configMode: 'GOLF_TIERED',
          templateKey: 'golf-tiered-pick-12',
          name: 'Select two from each tier, 8 count',
          description: 'Pick two golfers from each seeded tier.',
          sortOrder: 2,
          isDefault: false,
          active: true,
          schemaVersion: 1,
          configuration: {
            mode: 'GOLF_TIERED',
            maxEntriesPerSquad: 1,
            rosterSize: 12,
            countedScores: 8,
          },
        },
      ],
    },
  });
}

describe('CreateContestPage', () => {
  afterEach(() => {
    createManagedContestMock.mockReset();
    deleteContestMock.mockReset();
    getLeagueByCodeMock.mockReset();
    getManagedContestMock.mockReset();
    listManagedContestTemplatesMock.mockReset();
    listEventsMock.mockReset();
    updateContestMock.mockReset();
    updateManagedContestConfigurationMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('submits the commissioner golf tiered contest payload', async () => {
    primeCommonMocks();
    createManagedContestMock.mockResolvedValue({
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
    fireEvent.change(screen.getByTestId('contest-tiered-roster-size'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(createManagedContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: expect.objectContaining({
          name: 'Masters Pick 6',
          sportEventId: 'event-1',
          contestFormat: 'ROSTER',
          templateId: '11111111-1111-4111-8111-111111111111',
          configurationOverrides: expect.objectContaining({
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T11:55:00.000Z',
            rosterSize: 6,
            countedScores: 4,
          }),
        }),
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contest.create.succeeded',
        data: expect.objectContaining({
          contestId: 'contest-1',
        }),
      }),
      expect.any(String),
    );
  });

  it('pool-master-7wj.6 shows setup validation before submitting an unnamed contest', async () => {
    primeCommonMocks();

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    expect(await screen.findByTestId('create-contest-error')).toHaveTextContent(
      'Contest name is required.',
    );
    expect(createManagedContestMock).not.toHaveBeenCalled();
  });

  // pool-master-dxd.39 — pick-12 templates seed the wider roster shape.
  it('applies the pick-12 template roster size and counted scores', async () => {
    primeCommonMocks();
    createManagedContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-12',
        },
      },
    });

    renderCreateContestPage();

    await screen.findByTestId('contest-name');
    fireEvent.click(screen.getByTestId('contest-template-golf-tiered-pick-12'));

    expect(screen.getByTestId('contest-tiered-roster-size')).toHaveValue(12);
    expect(screen.getByTestId('contest-tiered-counted-scores')).toHaveValue(8);

    fireEvent.change(screen.getByTestId('contest-name'), {
      target: { value: 'Masters Pick 12' },
    });
    fireEvent.click(screen.getByTestId('create-contest-submit'));

    await waitFor(() =>
      expect(createManagedContestMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: expect.objectContaining({
          templateId: '33333333-3333-4333-8333-333333333333',
          configurationOverrides: expect.objectContaining({
            rosterSize: 12,
            countedScores: 8,
          }),
        }),
      }),
    );
  });

  it('shows the rejection message when contest creation is rejected with an expected payload', async () => {
    primeCommonMocks();
    createManagedContestMock.mockResolvedValue({
      error: {
        message: 'Contest name is already in use.',
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
    getManagedContestMock.mockResolvedValue({
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
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T11:55:00.000Z',
            maxEntriesPerSquad: 1,
            rosterSize: 6,
            countedScores: 4,
          },
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
            releaseAt: '2026-04-06T12:00:00.000Z',
            fieldLocksAt: '2026-04-10T11:00:00.000Z',
            participantCount: 0,
            fieldLocked: false,
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
    getManagedContestMock.mockResolvedValue({
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
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T11:55:00.000Z',
            maxEntriesPerSquad: 2,
            rosterSize: 6,
            countedScores: 4,
          },
        },
      },
    });
    updateContestMock.mockResolvedValue({ data: { contest: { id: 'contest-77' } } });
    updateManagedContestConfigurationMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-77',
        },
      },
    });

    renderContestPage('/league/BIGDAWGS/contests/contest-77/manage');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    expect(screen.getByTestId('contest-name')).toHaveValue('Masters Pick 6');
    expect(screen.getByTestId('contest-lock-preset')).toHaveValue('FIVE_MINUTES');

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
        body: expect.objectContaining({
          name: 'Masters Pick 6 Updated',
          lockAt: '2026-04-10T11:55:00.000Z',
        }),
      }),
    );

    await waitFor(() =>
      expect(updateManagedContestConfigurationMock).toHaveBeenCalledWith({
        path: { id: 'league-1', contestId: 'contest-77' },
        body: expect.objectContaining({
          mode: 'GOLF_TIERED',
          rosterSize: 6,
          countedScores: 3,
        }),
      }),
    );
  });

});
