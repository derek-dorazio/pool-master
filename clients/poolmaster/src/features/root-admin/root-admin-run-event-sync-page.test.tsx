import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminRunEventSyncPage } from './root-admin-run-event-sync-page';
import { sportLeagueFixture } from './sport-test-fixtures';

const {
  listProvidersMock,
  submitEventSyncMock,
  listEventsMock,
  listSportLeaguesMock,
  listSportLeagueSeasonsMock,
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
    listSportLeaguesMock: vi.fn(),
    listSportLeagueSeasonsMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  listProviders: listProvidersMock,
  submitEventSync: submitEventSyncMock,
  listEvents: listEventsMock,
  listSportLeagues: listSportLeaguesMock,
  listSportLeagueSeasons: listSportLeagueSeasonsMock,
});

/** Each sport's one league, whose current Season is its 2026 one; every league has a 2025 and a 2026 Season. */
const SEASONS = ['2026', '2025'].map((year) => ({
  id: `season-${year}`, name: year, championshipYear: Number(year), startsAt: `${year}-01-01T00:00:00.000Z`, endsAt: `${year}-12-31T00:00:00.000Z`,
  isCurrent: year === '2026', providerMappings: [], phases: [],
}));

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
    listSportLeaguesMock.mockImplementation(({ query }: { query: { sport: string } }) => Promise.resolve({
      data: { sportLeagues: [sportLeagueFixture({ id: `league-${query.sport}`, sport: query.sport as never, currentSeasonId: 'season-2026' })] },
    }));
    listSportLeagueSeasonsMock.mockResolvedValue({ data: { seasons: SEASONS } });

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
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sportLeagueSeasonId: 'season-2026' } });
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

  it('reads only the sport league\'s current Season of events, never every Season of the sport, and reads another Season when it is picked', async () => {
    renderPage();

    await waitFor(() => {
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sportLeagueSeasonId: 'season-2026' } });
    });
    expect(listSportLeaguesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sport: 'GOLF' } }));
    expect(listSportLeagueSeasonsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'league-GOLF' } }));

    fireEvent.change(await screen.findByTestId('root-admin-event-sync-season'), { target: { value: 'season-2025' } });

    await waitFor(() => {
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sportLeagueSeasonId: 'season-2025' } });
    });
    const calls = listEventsMock.mock.calls as [{ query: { sportLeagueSeasonId?: string } }][];
    expect(calls.every(([options]) => typeof options.query.sportLeagueSeasonId === 'string')).toBe(true);
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
      expect(listSportLeaguesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sport: 'BASKETBALL' } }));
      expect(listEventsMock).toHaveBeenCalledWith({ query: { sportLeagueSeasonId: 'season-2026' } });
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

  it('sends the chosen event\'s own provider when two providers\' events share an external id', async () => {
    listProvidersMock.mockResolvedValue({
      data: {
        providers: [
          { providerId: 'balldontlie', providerName: 'BALLDONTLIE', status: 'HEALTHY', sportsCovered: ['GOLF'], primaryForSports: [] },
          { providerId: 'feed-b', providerName: 'Feed B', status: 'HEALTHY', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] },
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
          { ...linkedEvent, id: 'event-b', providerId: 'feed-b', externalId: '41', name: 'Feed B Open' },
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

  });

  it('says so when provider health or the Season\'s events fail to load', async () => {
    listProvidersMock.mockResolvedValue({ error: { error: { code: 'TEST_UNKNOWN', message: 'Providers are down.' } } });
    listEventsMock.mockResolvedValue({ error: { error: { code: 'TEST_UNKNOWN', message: 'Events are down.' } } });

    renderPage();

    expect(await screen.findByText(/Provider health context is unavailable/)).toBeInTheDocument();
    expect(await screen.findByText('Loaded events are unavailable right now.')).toBeInTheDocument();
  });

  it('says the sync could not be submitted when the API refuses it, and logs it as a warning naming the event', async () => {
    submitEventSyncMock.mockResolvedValue({ error: { error: { code: 'TEST_UNKNOWN', message: 'That event cannot sync now.' } } });
    renderPage();

    await screen.findByRole('option', { name: /Manual Test Golf Tournament/ });
    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), { target: { value: 'event-internal-1' } });
    await waitFor(() => expect(screen.getByTestId('root-admin-event-sync-now')).toBeEnabled());
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));

    expect(await screen.findByText('We could not submit the event sync right now.')).toBeInTheDocument();
    const [fields, message] = mockLogger.warn.mock.calls.at(-1) as [{ action: string; data: { eventId: string | null } }, string];
    expect(fields).toMatchObject({ action: 'rootAdmin.eventSync.failed', data: { eventId: 'golf-masters-2026' } });
    expect(message).toBe('Manual provider event sync failed');
  });

});
