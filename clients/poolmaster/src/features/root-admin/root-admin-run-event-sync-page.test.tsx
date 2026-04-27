import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootAdminRunEventSyncPage } from './root-admin-run-event-sync-page';

const {
  adminListProvidersMock,
  adminSyncProviderEventDataMock,
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
    adminListProvidersMock: vi.fn(),
    adminSyncProviderEventDataMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListProviders: (...args: unknown[]) => adminListProvidersMock(...args),
  adminSyncProviderEventData: (...args: unknown[]) =>
    adminSyncProviderEventDataMock(...args),
  listEvents: (...args: unknown[]) => listEventsMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
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
    adminListProvidersMock.mockReset();
    adminSyncProviderEventDataMock.mockReset();
    listEventsMock.mockReset();

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
    adminSyncProviderEventDataMock.mockResolvedValue({
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
            releaseAt: '2026-04-20T16:00:00.000Z',
            fieldLocksAt: '2026-04-27T15:00:00.000Z',
            participantCount: 144,
            fieldLocked: false,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
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
          limit: 100,
        },
      });
    });

    expect(screen.queryByPlaceholderText('golf-masters-2026')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();

    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'golf-masters-2026' },
    });

    expect(screen.getByTestId('root-admin-event-sync-now')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));

    await waitFor(() => {
      expect(adminSyncProviderEventDataMock).toHaveBeenCalledWith({
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
});
