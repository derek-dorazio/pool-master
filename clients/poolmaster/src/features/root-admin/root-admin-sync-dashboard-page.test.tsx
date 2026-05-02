import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/api', () => ({
  adminListProviderSyncRuns: (...args: unknown[]) => adminListProviderSyncRunsMock(...args),
  adminListProviders: (...args: unknown[]) => adminListProvidersMock(...args),
}));

vi.mock('@/lib/logger', () => ({
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
});
