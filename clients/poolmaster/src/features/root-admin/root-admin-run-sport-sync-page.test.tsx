import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootAdminRunSportSyncPage } from './root-admin-run-sport-sync-page';

const {
  adminListProvidersMock,
  adminPrepareSportSyncMock,
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
    adminPrepareSportSyncMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListProviders: (...args: unknown[]) => adminListProvidersMock(...args),
  adminPrepareSportSync: (...args: unknown[]) => adminPrepareSportSyncMock(...args),
}));

vi.mock('@/lib/logger', () => ({
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
    adminListProvidersMock.mockReset();
    adminPrepareSportSyncMock.mockReset();

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
    adminPrepareSportSyncMock.mockResolvedValue({
      data: {
        sport: 'GOLF',
        requestedFeeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'],
        syncRuns: [{ id: 'sync-run-1' }],
      },
    });
  });

  it('submits a sport sync and shows the returned payload', async () => {
    renderPage();

    expect(
      await screen.findByTestId('root-admin-run-sport-sync-page'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('root-admin-sport-sync-now'));

    await waitFor(() => {
      expect(adminPrepareSportSyncMock).toHaveBeenCalledWith({
        path: { sport: 'GOLF' },
        body: {
          feeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'],
        },
      });
    });

    expect(
      await screen.findByTestId('root-admin-sport-sync-response'),
    ).toBeInTheDocument();
    expect(screen.getByText(/requestedFeeds/i)).toBeInTheDocument();
  });
});
