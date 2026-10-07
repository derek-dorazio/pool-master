import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminRunEventSyncPage } from './root-admin-run-event-sync-page';

const {
  listProvidersMock,
  submitEventSyncMock,
  listEventsMock,
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
    listProvidersMock: vi.fn(),
    submitEventSyncMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  listProviders: listProvidersMock,
  submitEventSync: submitEventSyncMock,
  listEvents: listEventsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderPage() {
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
        <RootAdminRunEventSyncPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminRunEventSyncPage', () => {
  beforeEach(() => {
    listProvidersMock.mockReset();
    submitEventSyncMock.mockReset();
    listEventsMock.mockReset();

    listProvidersMock.mockResolvedValue({
      data: {
        providers: [
          {
            providerId: 'mock-contest-feed',
            providerName: 'Mock contest feed',
            status: 'HEALTHY',
            sportsCovered: ['GOLF'],
          },
        ],
      },
    });
    submitEventSyncMock.mockResolvedValue({
      data: {
        sport: 'GOLF',
        eventId: 'golf-masters-2026',
        requestedFeeds: ['EVENTPARTICIPANTS'],
        syncRuns: [{ id: 'sync-run-2' }],
      },
    });
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-internal-1',
            externalId: 'golf-masters-2026',
            sport: 'GOLF',
            name: 'Manual Test Golf Tournament',
            venue: 'QA Course',
            location: 'Test City',
            status: 'SCHEDULED',
            startDate: '2026-04-27T16:00:00.000Z',
            endDate: null,
            participantCount: 144,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
            syncScope: 'SCORES_ONLY',
          },
        ],
      },
    });
  });

  it('pool-master-dxd.34 selects a loaded event and submits its provider event id', async () => {
    renderPage();

    expect(
      await screen.findByTestId('root-admin-run-event-sync-page'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(listEventsMock).toHaveBeenCalledWith({
        query: {
          sport: 'GOLF',
        },
      });
    });

    expect(screen.queryByPlaceholderText('golf-masters-2026')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();

    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'golf-masters-2026' },
    });

    expect(screen.getByTestId('root-admin-event-sync-now')).toBeEnabled();
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));

    await waitFor(() => {
      expect(submitEventSyncMock).toHaveBeenCalledWith({
        path: {
          sport: 'GOLF',
          eventId: 'golf-masters-2026',
        },
        body: {
          feeds: ['EVENTPARTICIPANTS'],
        },
      });
    });

    expect(
      await screen.findByTestId('root-admin-event-sync-response'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-event-sync-response'),
    ).toHaveTextContent('golf-masters-2026');
  });

  it('offers only events linked to a provider event, and explains the empty list when none is linked', async () => {
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-internal-2',
            externalId: 'manual-admin-unlinked',
            sport: 'GOLF',
            name: 'Unlinked Golf Tournament',
            venue: 'QA Course',
            location: 'Test City',
            status: 'SCHEDULED',
            startDate: '2026-04-27T16:00:00.000Z',
            endDate: null,
            participantCount: 0,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
            syncScope: 'NONE',
          },
        ],
      },
    });

    renderPage();

    expect(await screen.findByText(/No linked GOLF events match this preset/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Unlinked Golf Tournament/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();
  });

  it('pool-master-33l.8.8 submits mock event state controls for scheduled golf live-score syncs', async () => {
    renderPage();

    expect(
      await screen.findByTestId('root-admin-run-event-sync-page'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('root-admin-event-sync-preset'), {
      target: { value: 'EVENTLIVESCORES' },
    });
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();

    fireEvent.change(screen.getByTestId('root-admin-event-sync-mock-event-state'), {
      target: { value: 'live' },
    });
    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'golf-masters-2026' },
    });

    expect(screen.getByTestId('root-admin-event-sync-now')).toBeEnabled();
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));

    await waitFor(() => {
      expect(submitEventSyncMock).toHaveBeenCalledWith({
        path: {
          sport: 'GOLF',
          eventId: 'golf-masters-2026',
        },
        body: {
          feeds: ['EVENTLIVESCORES'],
          mockEventState: 'live',
        },
      });
    });
  });
});
