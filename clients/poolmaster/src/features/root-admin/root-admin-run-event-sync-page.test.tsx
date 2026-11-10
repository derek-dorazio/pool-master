import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
            primaryForSports: ['GOLF'],
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
            providerId: 'mock-contest-feed',
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
          eventYear: new Date().getFullYear(),
        },
      });
    });

    expect(screen.queryByPlaceholderText('golf-masters-2026')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();

    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'event-internal-1' },
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
          providerId: 'mock-contest-feed',
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

  it('reads only the chosen year of events, never every year of the sport, and reads the next year when the year changes', async () => {
    const thisYear = new Date().getFullYear();
    renderPage();

    await waitFor(() => {
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sport: 'GOLF', eventYear: thisYear } });
    });
    expect(listEventsMock).not.toHaveBeenCalledWith({ query: { sport: 'GOLF' } });

    fireEvent.change(screen.getByTestId('root-admin-event-sync-year'), {
      target: { value: String(thisYear - 1) },
    });

    await waitFor(() => {
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sport: 'GOLF', eventYear: thisYear - 1 } });
    });
    const calls = listEventsMock.mock.calls as [{ query: { eventYear?: number } }][];
    expect(calls.every(([options]) => typeof options.query.eventYear === 'number')).toBe(true);
  });

  it('offers only events linked to a provider event, names the sport by its display name, and explains the empty list when none is linked', async () => {
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

    expect(await screen.findByText(/No linked golf events match this preset/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Golf' })).toBeInTheDocument();
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
      target: { value: 'event-internal-1' },
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
          providerId: 'mock-contest-feed',
          feeds: ['EVENTLIVESCORES'],
          mockEventState: 'live',
        },
      });
    });
  });

  it('falls back to the first sport a provider syncs when no provider covers golf, and reads that sport\'s events', async () => {
    listProvidersMock.mockResolvedValue({
      data: {
        providers: [
          { providerId: 'espn', providerName: 'ESPN', status: 'HEALTHY', sportsCovered: ['BASKETBALL'], primaryForSports: ['BASKETBALL'] },
        ],
      },
    });
    listEventsMock.mockResolvedValue({ data: { events: [] } });

    renderPage();

    await waitFor(() => {
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sport: 'BASKETBALL', eventYear: new Date().getFullYear() } });
    });
    expect(screen.getByTestId('root-admin-event-sync-sport')).toHaveValue('BASKETBALL');
  });

  it('drops the selected event when the preset rules it out, so sync cannot run on it', async () => {
    renderPage();

    await screen.findByRole('option', { name: /Manual Test Golf Tournament/ });
    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'event-internal-1' },
    });
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeEnabled();

    // A scheduled event has no live scores to sync without a mock state.
    fireEvent.change(screen.getByTestId('root-admin-event-sync-preset'), {
      target: { value: 'EVENTLIVESCORES' },
    });

    expect(screen.getByTestId('root-admin-event-sync-event-id')).toHaveValue('');
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();
  });

  it('stops sending a mock event state once the chosen sport has no mock feed', async () => {
    listProvidersMock.mockResolvedValue({
      data: {
        providers: [
          { providerId: 'mock-contest-feed', providerName: 'Mock contest feed', status: 'HEALTHY', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] },
          { providerId: 'espn', providerName: 'ESPN', status: 'HEALTHY', sportsCovered: ['BASKETBALL'], primaryForSports: ['BASKETBALL'] },
        ],
      },
    });
    listEventsMock.mockImplementation(({ query }: { query: { sport: string } }) => Promise.resolve({
      data: {
        events: [{
          id: `event-${query.sport}`,
          providerId: query.sport === 'GOLF' ? 'mock-contest-feed' : 'espn',
          externalId: `${query.sport.toLowerCase()}-event`,
          sport: query.sport,
          name: `${query.sport} event`,
          venue: 'QA Venue',
          location: 'Test City',
          status: 'SCHEDULED',
          startDate: '2026-04-27T16:00:00.000Z',
          endDate: null,
          participantCount: 10,
          readinessStatus: 'CONTEST_ELIGIBLE',
          readinessReasons: [],
          contestEligible: true,
          syncScope: 'SCORES_ONLY',
        }],
      },
    }));
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-event-sync-mock-event-state'), {
      target: { value: 'live' },
    });
    expect(screen.getByText('Mock event state: live')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('root-admin-event-sync-sport'), {
      target: { value: 'BASKETBALL' },
    });

    expect(screen.queryByTestId('root-admin-event-sync-mock-event-state')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock event state: live')).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /BASKETBALL event/ })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), {
      target: { value: 'event-BASKETBALL' },
    });
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));

    await waitFor(() => {
      expect(submitEventSyncMock).toHaveBeenCalledWith({
        path: { sport: 'BASKETBALL', eventId: 'basketball-event' },
        body: { providerId: 'espn', feeds: ['EVENTPARTICIPANTS'] },
      });
    });
  });
  it('sends the chosen event\'s own provider, and narrows to the mock feed\'s events once a mock state is set', async () => {
    listProvidersMock.mockResolvedValue({
      data: {
        providers: [
          { providerId: 'balldontlie', providerName: 'BALLDONTLIE', status: 'HEALTHY', sportsCovered: ['GOLF'], primaryForSports: [] },
          { providerId: 'mock-contest-feed', providerName: 'Mock contest feed', status: 'HEALTHY', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] },
        ],
      },
    });
    const linkedEvent = {
      sport: 'GOLF',
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
    };
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          { ...linkedEvent, id: 'event-bdl', providerId: 'balldontlie', externalId: '41', name: 'BALLDONTLIE Open' },
          { ...linkedEvent, id: 'event-mock', providerId: 'mock-contest-feed', externalId: '41', name: 'Mock Open' },
        ],
      },
    });
    renderPage();

    expect(await screen.findByRole('option', { name: /BALLDONTLIE Open/ })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), { target: { value: 'event-bdl' } });
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));
    await waitFor(() => {
      expect(submitEventSyncMock).toHaveBeenCalledWith({
        path: { sport: 'GOLF', eventId: '41' },
        body: { providerId: 'balldontlie', feeds: ['EVENTPARTICIPANTS'] },
      });
    });

    fireEvent.change(screen.getByTestId('root-admin-event-sync-mock-event-state'), { target: { value: 'open' } });
    expect(screen.queryByRole('option', { name: /BALLDONTLIE Open/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mock Open/ })).toBeInTheDocument();
  });
});
