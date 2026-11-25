import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminRunEventSyncPage } from './root-admin-run-event-sync-page';
import type { SportLeagueOverviewDto } from '@/lib/api';
import { sportLeagueFixture } from './sport-test-fixtures';

const {
  listSportLeagueOverviewsMock,
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
    listSportLeagueOverviewsMock: vi.fn(),
    submitEventSyncMock: vi.fn(),
    listEventsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listSportLeagueSeasonsMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  listSportLeagueOverviews: listSportLeagueOverviewsMock,
  submitEventSync: submitEventSyncMock,
  listEvents: listEventsMock,
  listSportLeagues: listSportLeaguesMock,
  listSportLeagueSeasons: listSportLeagueSeasonsMock,
});

/** A sport league as the Sports page lists it: active, and synced from BALLDONTLIE unless overridden. */
function overview(overrides: Partial<SportLeagueOverviewDto> = {}): SportLeagueOverviewDto {
  return {
    id: 'pga-tour',
    sport: 'GOLF',
    sportUrlSegment: 'golf',
    sportDisplayOrder: 5,
    name: 'PGA TOUR',
    providerId: 'balldontlie',
    providerName: 'BALLDONTLIE',
    isActive: true,
    syncHealth: 'OK',
    issues: [],
    season: null,
    nextEventStartsAt: null,
    eventCount: 3,
    ...overrides,
  };
}

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
    listSportLeagueOverviewsMock.mockReset();
    submitEventSyncMock.mockReset();
    listEventsMock.mockReset();
    listSportLeaguesMock.mockImplementation(({ query }: { query: { sport: string } }) => Promise.resolve({
      data: { sportLeagues: [sportLeagueFixture({ id: `league-${query.sport}`, sport: query.sport as never, currentSeasonId: 'season-2026' })] },
    }));
    listSportLeagueSeasonsMock.mockResolvedValue({ data: { seasons: SEASONS } });

    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: [overview()] } });
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
            providerMappings: [{ providerCode: 'MOCK_CONTEST_FEED', providerName: 'Mock contest feed', externalId: 'golf-masters-2026' }],
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
            isTestData: false,
          },
        ],
      },
    });
  });

  it('pool-master-dxd.34 selects a loaded event and submits the sync by the event\'s own id', async () => {
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
        path: { eventId: 'event-internal-1' },
        body: { feeds: ['EVENTPARTICIPANTS'] },
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

  it('offers only provider-synced events, names the sport by its display name, and explains the empty list when none is synced', async () => {
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-internal-2',
            providerMappings: [],
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
            isTestData: true,
          },
        ],
      },
    });

    renderPage();

    expect(await screen.findByText(/No synced golf events match this preset/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Golf' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Unlinked Golf Tournament/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();
  });

  it('offers only the sports with an active synced league, in the sports\' order, and opens on the first', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({
      data: {
        sportLeagues: [
          overview(),
          overview({ id: 'nba', sport: 'BASKETBALL', sportUrlSegment: 'basketball', sportDisplayOrder: 3, name: 'NBA' }),
          overview({ id: 'mlb', sport: 'BASEBALL', sportUrlSegment: 'baseball', sportDisplayOrder: 2, name: 'MLB', isActive: false }),
          overview({ id: 'thoroughbred', sport: 'HORSE_RACING', sportUrlSegment: 'horse-racing', sportDisplayOrder: 9, name: 'US Thoroughbred', providerId: null, providerName: null }),
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
    expect(screen.getAllByRole('option', { name: /^(Basketball|Golf|Baseball|Horse racing)$/ }).map((option) => option.textContent)).toEqual(['Basketball', 'Golf']);
  });

  it('says there is nothing to sync when no active league is synced from a provider', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: [overview({ providerId: null, providerName: null })] } });

    renderPage();

    expect(await screen.findByText('No active sport league is synced from a provider, so there is nothing to sync.')).toBeInTheDocument();
    expect(listSportLeaguesMock).not.toHaveBeenCalled();
    expect(listEventsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('root-admin-event-sync-now')).toBeDisabled();
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

  it('sends the chosen event by its own id when two providers\' events share an external id', async () => {
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
      isTestData: false,
    };
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          { ...linkedEvent, id: 'event-bdl', providerMappings: [{ providerCode: 'BALLDONTLIE', providerName: 'BALLDONTLIE', externalId: '41' }], name: 'BALLDONTLIE Open' },
          { ...linkedEvent, id: 'event-b', providerMappings: [{ providerCode: 'FEED_B', providerName: 'Feed B', externalId: '41' }], name: 'Feed B Open' },
        ],
      },
    });
    renderPage();

    expect(await screen.findByRole('option', { name: /BALLDONTLIE Open/ })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('root-admin-event-sync-event-id'), { target: { value: 'event-bdl' } });
    fireEvent.click(screen.getByTestId('root-admin-event-sync-now'));
    await waitFor(() => {
      expect(submitEventSyncMock).toHaveBeenCalledWith({
        path: { eventId: 'event-bdl' },
        body: { feeds: ['EVENTPARTICIPANTS'] },
      });
    });

  });

  it('says the sport leagues could not be loaded when their list fails, and offers no sport', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ error: { error: { code: 'TEST_UNKNOWN', message: 'Leagues are down.' } } });

    renderPage();

    expect(await screen.findByText(/The sport leagues could not be loaded|Leagues are down/)).toBeInTheDocument();
    expect(listEventsMock).not.toHaveBeenCalled();
  });

  it('says so when the Season\'s events fail to load', async () => {
    listEventsMock.mockResolvedValue({ error: { error: { code: 'TEST_UNKNOWN', message: 'Events are down.' } } });

    renderPage();

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
    expect(fields).toMatchObject({ action: 'rootAdmin.eventSync.failed', data: { eventId: 'event-internal-1' } });
    expect(message).toBe('Manual provider event sync failed');
  });

});
