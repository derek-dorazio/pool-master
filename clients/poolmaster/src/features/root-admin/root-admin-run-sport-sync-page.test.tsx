import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminRunSportSyncPage } from './root-admin-run-sport-sync-page';

const {
  listProvidersMock,
  submitSportSyncMock,
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
    submitSportSyncMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  listProviders: listProvidersMock,
  submitSportSync: submitSportSyncMock,
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
        <RootAdminRunSportSyncPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminRunSportSyncPage', () => {
  beforeEach(() => {
    listProvidersMock.mockReset();
    submitSportSyncMock.mockReset();

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
    submitSportSyncMock.mockResolvedValue({
      data: {
        sport: 'GOLF',
        requestedFeeds: ['EVENTSCHEDULE'],
        syncRuns: [{ id: 'sync-run-1' }],
      },
    });
  });

  it('pool-master-7wj.7 replaces the sport sync form while provider sports load', async () => {
    listProvidersMock.mockReturnValue(new Promise(() => undefined));

    renderPage();

    const loading = await screen.findByTestId('root-admin-sport-sync-providers-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('root-admin-sport-sync-sport')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-sync-now')).not.toBeInTheDocument();
  });

  it('pool-master-rop.68.1.2 submits sport sync without event-scoped participant feeds', async () => {
    renderPage();

    expect(
      await screen.findByTestId('root-admin-run-sport-sync-page'),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('root-admin-sport-sync-now'));

    await waitFor(() => {
      expect(submitSportSyncMock).toHaveBeenCalledWith({
        path: { sport: 'GOLF' },
        body: {
          feeds: ['EVENTSCHEDULE'],
        },
      });
    });

    expect(
      await screen.findByTestId('root-admin-sport-sync-response'),
    ).toBeInTheDocument();
    expect(screen.getByText(/requestedFeeds/i)).toBeInTheDocument();
  });
});
