import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSyncDashboardPage } from './root-admin-sync-dashboard-page';

const {
  adminListProviderSyncRunsMock,
  adminListProvidersMock,
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
    adminListProviderSyncRunsMock: vi.fn(),
    adminListProvidersMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  adminListProviderSyncRuns: adminListProviderSyncRunsMock,
  adminListProviders: adminListProvidersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderDashboard() {
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
        <RootAdminSyncDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSyncDashboardPage', () => {
  beforeEach(() => {
    adminListProvidersMock.mockReset();
    adminListProviderSyncRunsMock.mockReset();

    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-contest-feed',
            providerName: 'Mock contest feed',
            status: 'HEALTHY',
            sportsCovered: ['GOLF'],
          },
        ],
      },
    });
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'sync-run-1',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            eventId: 'masters-2026',
            status: 'COMPLETED',
            startedAt: '2026-04-20T12:00:00.000Z',
            completedAt: '2026-04-20T12:04:00.000Z',
            createdAt: '2026-04-20T11:59:00.000Z',
            payload: {
              summary: 'Completed successfully',
              recordsProcessed: 12,
            },
          },
        ],
      },
    });
  });

  it('pool-master-dxd.36 renders provider health, sync history grid, and manual run links', async () => {
    renderDashboard();

    expect(
      await screen.findByTestId('root-admin-sync-dashboard-page'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('root-admin-sync-run-sync-run-1'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Mock contest feed').length).toBeGreaterThan(0);
    expect(screen.getByTestId('root-admin-sync-history-table')).toBeInTheDocument();
    expect(screen.getByTestId('data-grid-filter-provider')).toBeInTheDocument();
    expect(screen.getByTestId('data-grid-filter-status')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-provider-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-status-filter')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync history')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Most recent runs are shown first/),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sync-workflow-sequence')).toHaveTextContent(
      'ScheduleParticipantsRankings / oddsMock stateLive scores',
    );
    expect(
      screen.getByTestId('root-admin-open-run-sport-sync-page'),
    ).toHaveAttribute('href', '/manage/sync/run-sport-sync');
    expect(
      screen.getByTestId('root-admin-open-run-event-sync-page'),
    ).toHaveAttribute('href', '/manage/sync/run-event-sync');
    expect(screen.getByText('Completed successfully')).toBeInTheDocument();
    expect(adminListProviderSyncRunsMock).toHaveBeenLastCalledWith({
      query: {
        limit: 25,
      },
    });
  });

  it('pool-master-dxd.36 filters sync history client-side through grid column filters', async () => {
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'sync-run-1',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            eventId: 'masters-2026',
            status: 'COMPLETED',
            startedAt: '2026-04-20T12:00:00.000Z',
            completedAt: '2026-04-20T12:04:00.000Z',
            createdAt: '2026-04-20T11:59:00.000Z',
            payload: {
              summary: 'Completed successfully',
              recordsProcessed: 12,
            },
          },
          {
            id: 'sync-run-2',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            eventId: 'open-2026',
            status: 'FAILED',
            startedAt: '2026-04-21T12:00:00.000Z',
            completedAt: '2026-04-21T12:01:00.000Z',
            createdAt: '2026-04-21T11:59:00.000Z',
            payload: {
              summary: 'Failed event sync',
              recordsProcessed: 0,
            },
          },
        ],
      },
    });

    renderDashboard();

    await screen.findByTestId('root-admin-sync-run-sync-run-1');
    fireEvent.change(screen.getByTestId('data-grid-filter-status'), {
      target: {
        value: 'FAILED',
      },
    });

    expect(screen.queryByTestId('root-admin-sync-run-sync-run-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sync-run-sync-run-2')).toBeInTheDocument();
    expect(adminListProviderSyncRunsMock).toHaveBeenCalledTimes(1);
  });

  it('pool-master-ueu.2 shows warning diagnostics and raw provider payload drill-down', async () => {
    const user = userEvent.setup();
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'sync-run-warning',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            eventId: null,
            status: 'COMPLETED',
            startedAt: '2026-05-25T12:00:00.000Z',
            completedAt: '2026-05-25T12:01:00.000Z',
            createdAt: '2026-05-25T11:59:00.000Z',
            payload: {
              runType: 'MANUAL_SPORT_SYNC',
              requestedFeed: 'EVENTSCHEDULE',
              outcome: {
                severity: 'WARNING',
                summary: 'Completed event schedule sync for GOLF (0 records).',
                warnings: [
                  {
                    code: 'NO_PROVIDER_EVENTS',
                    message: 'Provider returned no upcoming events for the requested sport/date window.',
                  },
                ],
                errors: 0,
              },
              stats: {
                providerRecordsReturned: 0,
                eventsFetched: 0,
              },
              requestPayload: {
                sport: 'GOLF',
                feeds: ['EVENTSCHEDULE'],
              },
              providerPayload: {
                operation: 'EVENTSCHEDULE',
                rawCaptured: true,
                rawTruncated: false,
                raw: [
                  {
                    path: '/v1/scenarios/golf/events',
                    raw: { events: [] },
                  },
                ],
              },
              jobPayload: {
                jobType: 'EVENT_SCHEDULE_SYNC',
                status: 'COMPLETED',
                recordsProcessed: 0,
              },
            },
          },
        ],
      },
    });

    renderDashboard();

    expect(await screen.findByText('COMPLETED WITH WARNINGS')).toBeInTheDocument();
    expect(
      screen.getByText('Completed event schedule sync for GOLF (0 records).'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Sync run details')).toBeInTheDocument();
    expect(screen.getByText('Provider Records Returned')).toBeInTheDocument();
    expect(screen.getByText('Events Fetched')).toBeInTheDocument();
    expect(
      screen.getByText('Provider returned no upcoming events for the requested sport/date window.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Payloads' }));
    await user.click(screen.getByRole('button', { name: 'Show provider payload' }));

    expect(await screen.findByText('Provider payload')).toBeInTheDocument();
    expect(screen.getByText(/"rawCaptured": true/)).toBeInTheDocument();
    expect(screen.getByText(/"events": \[\]/)).toBeInTheDocument();
  });

  it('pool-master-33l.8.9 renders run-specific detail rows separately from payload JSON', async () => {
    const user = userEvent.setup();
    adminListProviderSyncRunsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'sync-run-detail',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            eventId: 'masters-2026',
            status: 'COMPLETED',
            startedAt: '2026-05-25T12:00:00.000Z',
            completedAt: '2026-05-25T12:01:00.000Z',
            createdAt: '2026-05-25T11:59:00.000Z',
            payload: {
              runType: 'MANUAL_EVENT_SYNC',
              requestedFeed: 'EVENTPARTICIPANTS',
              outcome: {
                severity: 'SUCCESS',
                summary: 'Completed event participants sync for masters-2026 (2 records).',
                warnings: [],
                errors: 0,
              },
              stats: {
                eventsHydrated: 1,
                participantsReturned: 2,
              },
              requestPayload: {
                sport: 'GOLF',
                eventId: 'masters-2026',
                feeds: ['EVENTPARTICIPANTS'],
              },
              providerPayload: {
                operation: 'EVENTPARTICIPANTS',
                rawCaptured: true,
                rawTruncated: false,
                raw: [
                  {
                    path: '/v1/scenarios/golf/events/masters-2026/detail',
                    raw: {
                      event: {
                        eventId: 'masters-2026',
                        name: 'Masters 2026',
                        status: 'field_announced',
                        field: {
                          contestants: [
                            {
                              contestantId: 'golfer-1',
                              name: 'Jordan Example',
                              ranking: 3,
                              odds: 1200,
                            },
                            {
                              contestantId: 'golfer-2',
                              name: 'Casey Example',
                              ranking: 18,
                              odds: 2400,
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
              jobPayload: {
                jobType: 'EVENT_PARTICIPANTS_SYNC',
                status: 'COMPLETED',
                recordsProcessed: 2,
              },
            },
          },
        ],
      },
    });

    renderDashboard();

    expect(await screen.findByTestId('root-admin-sync-run-sync-run-detail')).toBeInTheDocument();
    expect(
      await screen.findByText('Events Hydrated: 1 · Participants Returned: 2'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View details' }));

    expect(await screen.findByText('Sync run details')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Details' }));

    expect(await screen.findByTestId('root-admin-sync-detail-grid')).toBeInTheDocument();
    expect(screen.getByText('Jordan Example')).toBeInTheDocument();
    expect(screen.getByText('ranking: 3 · odds: 1200')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Payloads' }));
    await user.click(screen.getByRole('button', { name: 'Show request payload' }));

    expect(await screen.findByText('Request payload')).toBeInTheDocument();
    expect(screen.getByText(/"eventId": "masters-2026"/)).toBeInTheDocument();
  });
});
