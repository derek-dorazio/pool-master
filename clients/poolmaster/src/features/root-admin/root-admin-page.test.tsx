import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootAdminPage } from './root-admin-page';

const adminListProviderSyncRunsMock = vi.fn();
const adminListProvidersMock = vi.fn();

vi.mock('@/lib/api', () => ({
  adminListProviderSyncRuns: (...args: unknown[]) => adminListProviderSyncRunsMock(...args),
  adminListProviders: (...args: unknown[]) => adminListProvidersMock(...args),
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

describe('RootAdminPage', () => {
  afterEach(() => {
    adminListProviderSyncRunsMock.mockReset();
    adminListProvidersMock.mockReset();
  });

  it('renders recent provider sync runs with provider names and payload summaries', async () => {
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
    const syncRunCard = screen.getByTestId('root-admin-sync-run-run-1');
    expect(within(syncRunCard).getByText('Mock Golf Provider')).toBeInTheDocument();
    expect(within(syncRunCard).getByText('Imported event field and odds snapshot.')).toBeInTheDocument();
    expect(within(syncRunCard).getByText('masters-2026')).toBeInTheDocument();
    expect(within(syncRunCard).getByText('COMPLETED')).toBeInTheDocument();
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

    await screen.findByText('Recent sync runs');

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
});
