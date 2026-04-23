import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootAdminPage } from './root-admin-page';

const {
  adminGetIngestionScheduleMock,
  adminGetPollIntervalsMock,
  adminListProviderSyncRunsMock,
  adminListContestConfigTemplatesMock,
  adminListProvidersMock,
  adminPrepareSportSyncMock,
  adminResetIngestionScheduleMock,
  adminResetPollIntervalsMock,
  adminResetSportIngestionOverrideMock,
  adminSetSportIngestionOverrideMock,
  adminSyncProviderEventDataMock,
  adminUpdateContestConfigTemplateMock,
  adminUpdateIngestionScheduleMock,
  adminUpdatePollIntervalsMock,
  mockLogger,
} = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    adminGetIngestionScheduleMock: vi.fn(),
    adminGetPollIntervalsMock: vi.fn(),
    adminListProviderSyncRunsMock: vi.fn(),
    adminListContestConfigTemplatesMock: vi.fn(),
    adminListProvidersMock: vi.fn(),
    adminPrepareSportSyncMock: vi.fn(),
    adminResetIngestionScheduleMock: vi.fn(),
    adminResetPollIntervalsMock: vi.fn(),
    adminResetSportIngestionOverrideMock: vi.fn(),
    adminSetSportIngestionOverrideMock: vi.fn(),
    adminSyncProviderEventDataMock: vi.fn(),
    adminUpdateContestConfigTemplateMock: vi.fn(),
    adminUpdateIngestionScheduleMock: vi.fn(),
    adminUpdatePollIntervalsMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminGetIngestionSchedule: (...args: unknown[]) => adminGetIngestionScheduleMock(...args),
  adminGetPollIntervals: (...args: unknown[]) => adminGetPollIntervalsMock(...args),
  adminListProviderSyncRuns: (...args: unknown[]) => adminListProviderSyncRunsMock(...args),
  adminListContestConfigTemplates: (...args: unknown[]) => adminListContestConfigTemplatesMock(...args),
  adminListProviders: (...args: unknown[]) => adminListProvidersMock(...args),
  adminPrepareSportSync: (...args: unknown[]) => adminPrepareSportSyncMock(...args),
  adminResetIngestionSchedule: (...args: unknown[]) => adminResetIngestionScheduleMock(...args),
  adminResetPollIntervals: (...args: unknown[]) => adminResetPollIntervalsMock(...args),
  adminResetSportIngestionOverride: (...args: unknown[]) => adminResetSportIngestionOverrideMock(...args),
  adminSetSportIngestionOverride: (...args: unknown[]) => adminSetSportIngestionOverrideMock(...args),
  adminSyncProviderEventData: (...args: unknown[]) => adminSyncProviderEventDataMock(...args),
  adminUpdateContestConfigTemplate: (...args: unknown[]) => adminUpdateContestConfigTemplateMock(...args),
  adminUpdateIngestionSchedule: (...args: unknown[]) => adminUpdateIngestionScheduleMock(...args),
  adminUpdatePollIntervals: (...args: unknown[]) => adminUpdatePollIntervalsMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function renderRootAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function seedRootAdminDefaults() {
  adminGetPollIntervalsMock.mockResolvedValue({
    data: {
      standings: 10000,
      draft: 10000,
      contestStatus: 30000,
      notifications: 30000,
      default: 30000,
    },
  });
  adminUpdatePollIntervalsMock.mockResolvedValue({
    data: {
      standings: 10000,
      draft: 10000,
      contestStatus: 30000,
      notifications: 30000,
      default: 30000,
    },
  });
  adminResetPollIntervalsMock.mockResolvedValue({
    data: {
      standings: 10000,
      draft: 10000,
      contestStatus: 30000,
      notifications: 30000,
      default: 30000,
    },
  });
  adminGetIngestionScheduleMock.mockResolvedValue({
    data: {
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
      eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
      participantRankings: { enabled: true, intervalMinutes: 1440 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      eventResults: { enabled: true, intervalMinutes: 30 },
      perSportOverrides: {},
    },
  });
  adminUpdateIngestionScheduleMock.mockResolvedValue({
    data: {
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
      eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
      participantRankings: { enabled: true, intervalMinutes: 1440 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      eventResults: { enabled: true, intervalMinutes: 30 },
      perSportOverrides: {},
    },
  });
  adminResetIngestionScheduleMock.mockResolvedValue({
    data: {
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
      eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
      participantRankings: { enabled: true, intervalMinutes: 1440 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      eventResults: { enabled: true, intervalMinutes: 30 },
      perSportOverrides: {},
    },
  });
  adminSetSportIngestionOverrideMock.mockResolvedValue({
    data: {
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
      eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
      participantRankings: { enabled: true, intervalMinutes: 1440 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      eventResults: { enabled: true, intervalMinutes: 30 },
      perSportOverrides: {
        GOLF: {
          eventLiveScores: { enabled: false },
        },
      },
    },
  });
  adminResetSportIngestionOverrideMock.mockResolvedValue({
    data: {
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
      eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
      participantRankings: { enabled: true, intervalMinutes: 1440 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      eventResults: { enabled: true, intervalMinutes: 30 },
      perSportOverrides: {},
    },
  });
  adminListContestConfigTemplatesMock.mockResolvedValue({
    data: {
      templates: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          sport: 'GOLF',
          eventType: null,
          contestType: 'SINGLE_EVENT',
          configMode: 'GOLF_TIERED',
          templateKey: 'golf-tiered-pick-6',
          name: 'Select one from each tier, 4 count',
          description: 'Pick one golfer from each seeded tier. The best four scores count for the entry total.',
          sortOrder: 1,
          isDefault: true,
          active: true,
          schemaVersion: 1,
          configuration: {
            mode: 'GOLF_TIERED',
            rosterSize: 6,
            countedScores: 4,
            tierSource: 'ODDS',
            tierGeneration: { defaultTierSize: 10 },
            tiers: [
              { tierKey: 'A', label: 'Tier A', pickCount: 1, startPosition: 1, endPosition: 10 },
              { tierKey: 'B', label: 'Tier B', pickCount: 1, startPosition: 11, endPosition: 20 },
            ],
            cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
            playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
            displayScoring: 'TO_PAR',
            tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
          },
        },
      ],
    },
  });
  adminUpdateContestConfigTemplateMock.mockResolvedValue({
    data: {
      template: {
        id: '11111111-1111-4111-8111-111111111111',
        sport: 'GOLF',
        eventType: null,
        contestType: 'SINGLE_EVENT',
        configMode: 'GOLF_TIERED',
        templateKey: 'golf-tiered-pick-6',
        name: 'Select one from each tier, 4 count',
        description: 'Pick one golfer from each seeded tier. The best four scores count for the entry total.',
        sortOrder: 1,
        isDefault: true,
        active: true,
        schemaVersion: 1,
        configuration: {
          mode: 'GOLF_TIERED',
          rosterSize: 6,
          countedScores: 4,
          tierSource: 'ODDS',
          tierGeneration: { defaultTierSize: 10 },
          tiers: [
            { tierKey: 'A', label: 'Tier A', pickCount: 1, startPosition: 1, endPosition: 10 },
            { tierKey: 'B', label: 'Tier B', pickCount: 1, startPosition: 11, endPosition: 20 },
          ],
          cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
          playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
          displayScoring: 'TO_PAR',
          tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
        },
      },
    },
  });
}

describe('RootAdminPage', () => {
  beforeEach(() => {
    seedRootAdminDefaults();
  });

  afterEach(() => {
    adminGetIngestionScheduleMock.mockReset();
    adminGetPollIntervalsMock.mockReset();
    adminListProviderSyncRunsMock.mockReset();
    adminListContestConfigTemplatesMock.mockReset();
    adminListProvidersMock.mockReset();
    adminPrepareSportSyncMock.mockReset();
    adminResetIngestionScheduleMock.mockReset();
    adminResetPollIntervalsMock.mockReset();
    adminResetSportIngestionOverrideMock.mockReset();
    adminSetSportIngestionOverrideMock.mockReset();
    adminSyncProviderEventDataMock.mockReset();
    adminUpdateContestConfigTemplateMock.mockReset();
    adminUpdateIngestionScheduleMock.mockReset();
    adminUpdatePollIntervalsMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('renders recent provider sync runs in the sync history table', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-golf-provider',
            providerName: 'Mock Golf Provider',
            status: 'HEALTHY',
            errorRate: 0,
            latencyMs: 18,
            lastEventAt: '2026-04-19T16:00:00.000Z',
            sportsCovered: ['GOLF'],
            activeEventCount: 3,
          },
        ],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'run-1',
            providerId: 'mock-golf-provider',
            sport: 'GOLF',
            eventId: 'masters-2026',
            status: 'COMPLETED',
            startedAt: '2026-04-19T16:05:00.000Z',
            completedAt: '2026-04-19T16:05:20.000Z',
            createdAt: '2026-04-19T16:05:00.000Z',
            payload: {
              runType: 'EVENT_SYNC',
              recordsProcessed: 42,
              detail: 'Imported event field and odds snapshot.',
            },
          },
        ],
      },
    });

    renderRootAdminPage();

    expect(await screen.findByText('Provider sync visibility')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-sync-history-table')).toBeInTheDocument();
    const syncRunCard = await screen.findByTestId('root-admin-sync-run-run-1');
    expect(within(syncRunCard).getByText('Mock Golf Provider')).toBeInTheDocument();
    expect(within(syncRunCard).getByText('Imported event field and odds snapshot.')).toBeInTheDocument();
    expect(within(syncRunCard).getByText('masters-2026')).toBeInTheDocument();
    expect(within(syncRunCard).getByText('COMPLETED')).toBeInTheDocument();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rootAdmin.page.loaded',
      }),
      expect.any(String),
    );
  });

  it('refetches sync runs when filters change', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-golf-provider',
            providerName: 'Mock Golf Provider',
            status: 'HEALTHY',
            errorRate: 0,
            latencyMs: 18,
            lastEventAt: '2026-04-19T16:00:00.000Z',
            sportsCovered: ['GOLF'],
            activeEventCount: 3,
          },
        ],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [],
      },
    });

    renderRootAdminPage();

    await screen.findByText('Sync history');
    await screen.findByRole('option', { name: 'Mock Golf Provider' });

    fireEvent.change(screen.getByTestId('root-admin-provider-filter'), {
      target: { value: 'mock-golf-provider' },
    });

    await waitFor(() =>
      expect(adminListProviderSyncRunsMock).toHaveBeenLastCalledWith({
        query: {
          providerId: 'mock-golf-provider',
          sport: undefined,
          status: undefined,
          limit: 25,
        },
      }),
    );
  });

  it('shows an empty state when no sync runs match the current filters', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [],
      },
    });

    renderRootAdminPage();

    expect(await screen.findByText('No sync runs matched the current filters.')).toBeInTheDocument();
  });

  it('triggers a manual sport sync from the same page section', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-golf-provider',
            providerName: 'Mock Golf Provider',
            status: 'HEALTHY',
            errorRate: 0,
            latencyMs: 18,
            lastEventAt: '2026-04-19T16:00:00.000Z',
            sportsCovered: ['GOLF'],
            activeEventCount: 3,
          },
        ],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [],
      },
    });
    adminPrepareSportSyncMock.mockResolvedValue({
      data: {
        sport: 'GOLF',
        eventId: null,
        requestedFeeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'],
        jobs: [
          {
            jobType: 'EVENT_SCHEDULE_SYNC',
            providerId: 'mock-golf-provider',
            sport: 'GOLF',
            status: 'COMPLETED',
            recordsProcessed: 2,
            errors: 0,
            errorLog: [],
          },
          {
            jobType: 'EVENT_PARTICIPANTS_SYNC',
            providerId: 'mock-golf-provider',
            sport: 'GOLF',
            status: 'COMPLETED',
            recordsProcessed: 2,
            errors: 0,
            errorLog: [],
          },
          {
            jobType: 'PARTICIPANT_RANKINGS_SYNC',
            providerId: 'mock-golf-provider',
            sport: 'GOLF',
            status: 'COMPLETED',
            recordsProcessed: 144,
            errors: 0,
            errorLog: [],
          },
        ],
        syncRuns: [
          {
            id: 'run-2',
            providerId: 'mock-golf-provider',
            sport: 'GOLF',
            eventId: null,
            status: 'COMPLETED',
            startedAt: '2026-04-19T16:05:00.000Z',
            completedAt: '2026-04-19T16:06:00.000Z',
            createdAt: '2026-04-19T16:05:00.000Z',
            payload: {
              runType: 'MANUAL_SPORT_SYNC',
              detail: 'Prepared 2 GOLF event fields for contest setup.',
            },
          },
        ],
      },
    });

    renderRootAdminPage();

    await screen.findByText('Sync history');

    fireEvent.click(screen.getByTestId('root-admin-sport-sync-now'));

    await waitFor(() =>
      expect(adminPrepareSportSyncMock).toHaveBeenCalledWith({
        path: {
          sport: 'GOLF',
        },
        body: {
          feeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'],
        },
      }),
    );

    expect(await screen.findByTestId('root-admin-sport-sync-success')).toHaveTextContent(
      'Completed Prepare event data for GOLF. 3 feed jobs completed.',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rootAdmin.sync.succeeded',
      }),
      expect.any(String),
    );
  });

  it('limits manual sync sports to the configured provider coverage', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-golf-provider',
            providerName: 'Mock Golf Provider',
            status: 'HEALTHY',
            errorRate: 0,
            latencyMs: 18,
            lastEventAt: '2026-04-19T16:00:00.000Z',
            sportsCovered: ['GOLF'],
            activeEventCount: 3,
          },
          {
            providerId: 'mock-football-provider',
            providerName: 'Mock Football Provider',
            status: 'HEALTHY',
            errorRate: 0,
            latencyMs: 21,
            lastEventAt: '2026-04-19T16:00:00.000Z',
            sportsCovered: ['NFL'],
            activeEventCount: 2,
          },
        ],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [],
      },
    });

    renderRootAdminPage();

    await screen.findByText('Sync history');

    const sportSyncSelect = await screen.findByTestId('root-admin-sport-sync-sport');
    const eventSyncSelect = await screen.findByTestId('root-admin-event-sync-sport');

    await waitFor(() => {
      expect(within(sportSyncSelect).getByRole('option', { name: 'GOLF' })).toBeInTheDocument();
      expect(within(sportSyncSelect).getByRole('option', { name: 'NFL' })).toBeInTheDocument();
      expect(within(sportSyncSelect).queryByRole('option', { name: 'UFC' })).not.toBeInTheDocument();
      expect(within(eventSyncSelect).getByRole('option', { name: 'GOLF' })).toBeInTheDocument();
      expect(within(eventSyncSelect).getByRole('option', { name: 'NFL' })).toBeInTheDocument();
    });
  });

  it('triggers a manual event sync with an explicit event preset', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-golf-provider',
            providerName: 'Mock Golf Provider',
            status: 'HEALTHY',
            errorRate: 0,
            latencyMs: 18,
            lastEventAt: '2026-04-19T16:00:00.000Z',
            sportsCovered: ['GOLF'],
            activeEventCount: 3,
          },
        ],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [],
      },
    });
    adminSyncProviderEventDataMock.mockResolvedValue({
      data: {
        sport: 'GOLF',
        eventId: 'masters-2026',
        requestedFeeds: ['EVENTLIVESCORES'],
        jobs: [
          {
            jobType: 'EVENT_LIVE_SCORES_SYNC',
            providerId: 'mock-golf-provider',
            sport: 'GOLF',
            eventExternalId: 'masters-2026',
            status: 'COMPLETED',
            recordsProcessed: 18,
            errors: 0,
            errorLog: [],
          },
        ],
        syncRuns: [],
      },
    });

    renderRootAdminPage();

    await screen.findByText('Sync history');

    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'masters-2026' },
    });
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));

    await waitFor(() =>
      expect(adminSyncProviderEventDataMock).toHaveBeenCalledWith({
        path: {
          sport: 'GOLF',
          eventId: 'masters-2026',
        },
        body: {
          feeds: ['EVENTLIVESCORES'],
        },
      }),
    );

    expect(await screen.findByTestId('root-admin-event-sync-success')).toHaveTextContent(
      'Completed Refresh live scores for masters-2026. 1 feed job completed.',
    );
  });

  it('shows the sync-runs load failure state and logs the warning branch', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [],
      },
    });
    adminListProviderSyncRunsMock.mockRejectedValue(new Error('Sync history unavailable'));

    renderRootAdminPage();

    expect(await screen.findByText('Sync history unavailable')).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rootAdmin.syncRuns.failed',
      }),
      expect.any(String),
    );
  });

  it('saves updated poll interval configuration from the manage section', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: { items: [] },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: { items: [] },
    });

    renderRootAdminPage();

    const standingsInput = await screen.findByTestId('root-admin-poll-standings');
    fireEvent.change(standingsInput, {
      target: { value: '15000' },
    });
    fireEvent.click(screen.getByTestId('root-admin-poll-save'));

    await waitFor(() =>
      expect(adminUpdatePollIntervalsMock).toHaveBeenCalledWith({
        body: {
          standings: 15000,
          draft: 10000,
          contestStatus: 30000,
          notifications: 30000,
          default: 30000,
        },
      }),
    );
  });

  it('saves updated contest template defaults from the manage section', async () => {
    adminListProvidersMock.mockResolvedValue({
      data: { items: [] },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: { items: [] },
    });

    renderRootAdminPage();

    const nameInput = await screen.findByTestId('root-admin-template-name-11111111-1111-4111-8111-111111111111');
    fireEvent.change(nameInput, {
      target: { value: 'Updated Pick 6 Default' },
    });
    fireEvent.click(screen.getByTestId('root-admin-template-save-11111111-1111-4111-8111-111111111111'));

    await waitFor(() =>
      expect(adminUpdateContestConfigTemplateMock).toHaveBeenCalledWith({
        path: {
          templateId: '11111111-1111-4111-8111-111111111111',
        },
        body: expect.objectContaining({
          name: 'Updated Pick 6 Default',
          description: 'Pick one golfer from each seeded tier. The best four scores count for the entry total.',
          sortOrder: 1,
          active: true,
          isDefault: true,
        }),
      }),
    );
  });
});
