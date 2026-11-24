import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventToolsTab } from './event-tools-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import { sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';

// plans/124 §6.3 — the Event page's Tools tab: linking a manual event to a provider's scores
// (pool-master-3dg, #1890).

const {
  listSportLeaguesMock,
  getEventMock,
  listEventRoundsMock,
  linkEventScoreSourceMock,
  listProviderCatalogEventsMock,
  listProvidersMock,
  releaseEventMock,
  transitionEventMock,
  unlinkEventScoreSourceMock,
  updateEventMock,
  updateEventRoundsMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    listSportLeaguesMock: vi.fn(),
    getEventMock: vi.fn(),
    listEventRoundsMock: vi.fn(),
    linkEventScoreSourceMock: vi.fn(),
    listProviderCatalogEventsMock: vi.fn(),
    listProvidersMock: vi.fn(),
    releaseEventMock: vi.fn(),
    transitionEventMock: vi.fn(),
    unlinkEventScoreSourceMock: vi.fn(),
    updateEventMock: vi.fn(),
    updateEventRoundsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  getEvent: getEventMock,
  listEventRounds: listEventRoundsMock,
  linkEventScoreSource: linkEventScoreSourceMock,
  listProviderCatalogEvents: listProviderCatalogEventsMock,
  listProviders: listProvidersMock,
  releaseEvent: releaseEventMock,
  transitionEvent: transitionEventMock,
  unlinkEventScoreSource: unlinkEventScoreSourceMock,
  updateEvent: updateEventMock,
  updateEventRounds: updateEventRoundsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'tour-1',
    name: 'Rolling Weekend Invitational',
    venue: 'Mock Golf Club',
    location: 'Augusta, GA',
    startDate: '2026-05-07T12:00:00.000Z',
    endDate: '2026-05-10T22:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    eventSeriesId: 'event-series-1',
    sportLeagueSeasonId: 'season-2026',
    championshipYear: 2026,
    sportLeagueId: 'league-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    loadedParticipantCount: 120,
    tierCount: 6,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierLabels: [], contestCount: 0 },
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    allowedTransitions: ['IN_PROGRESS', 'CANCELLED'],
    ...overrides,
  });
}

function seedDefaults() {
  getEventMock.mockResolvedValue({ data: { event: tournament() } });
  listEventRoundsMock.mockResolvedValue({
    data: {
      rounds: [
        { roundNumber: 1, scheduledDate: '2026-05-07T12:00:00.000Z', scheduledEndAt: '2026-05-07T22:00:00.000Z' },
        { roundNumber: 2, scheduledDate: '2026-05-08T12:00:00.000Z', scheduledEndAt: '' },
      ],
    },
  });
  listSportLeaguesMock.mockResolvedValue({
    data: { sportLeagues: [sportLeagueFixture({ id: 'league-1', name: 'PGA Tour' })] },
  });
}

function renderPage(path = '/manage/sports/golf/events/tour-1/tools') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<EventTabOutlet />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventToolsTab />} path="tools" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function refusal(code: string, message: string, status = 422) {
  return { error: { error: { code, message } }, response: { status } };
}

describe('The Event page\'s Tools tab: the score source link', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-3dg opens the score-source picker for an unlinked tournament', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            externalId: 'mock-weekend',
            name: 'Mock Weekend Event',
            startDate: '2026-05-07T12:00:00.000Z',
            endDate: '2026-05-10T22:00:00.000Z',
            status: 'SCHEDULED',
          },
        ],
      },
    });
    linkEventScoreSourceMock.mockResolvedValue({
      data: { event: tournament({ syncScope: 'SCORES_ONLY' }) },
    });
    renderPage();

    expect(
      await screen.findByText('Not linked — scores must be entered manually.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('root-admin-sport-event-link-open'));

    const modal = await screen.findByTestId('root-admin-sport-event-link-modal');
    fireEvent.click(
      await within(modal).findByTestId(
        'root-admin-sport-event-link-option-mock-weekend',
      ),
    );
    fireEvent.click(within(modal).getByTestId('root-admin-sport-event-link-modal-apply'));

    await waitFor(() =>
      expect(linkEventScoreSourceMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { providerId: 'mock-contest-feed', externalId: 'mock-weekend' },
      }),
    );
  });

  it('pool-master-3dg unlinks a linked score source after confirmation', async () => {
    getEventMock.mockResolvedValue({
      data: {
        event: tournament({
          syncScope: 'SCORES_ONLY',
          providerId: 'mock-contest-feed', externalId: 'mock-weekend',
        }),
      },
    });
    listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    listSportLeaguesMock.mockResolvedValue({
      data: { sportLeagues: [sportLeagueFixture({ id: 'league-1', name: 'PGA Tour' })] },
    });
    unlinkEventScoreSourceMock.mockResolvedValue({
      data: { event: tournament({ syncScope: 'NONE' }) },
    });
    renderPage();

    fireEvent.click(
      await screen.findByTestId('root-admin-sport-event-unlink-open'),
    );
    fireEvent.click(
      await screen.findByTestId('root-admin-sport-event-unlink-confirm'),
    );

    await waitFor(() =>
      expect(unlinkEventScoreSourceMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
      }),
    );
  });

  it('shows the server\'s reason inside the picker when linking a provider event is refused', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({
      data: {
        events: [{
          externalId: 'mock-weekend',
          name: 'Mock Weekend Event',
          startDate: '2026-05-07T12:00:00.000Z',
          endDate: '2026-05-10T22:00:00.000Z',
          status: 'SCHEDULED',
        }],
      },
    });
    linkEventScoreSourceMock.mockResolvedValue({
      error: { error: { code: 'PROVIDER_SPORT_MISMATCH', message: 'Provider mock-contest-feed does not cover GOLF.' } },
      response: { status: 422 },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-link-open'));
    const modal = await screen.findByTestId('root-admin-sport-event-link-modal');
    fireEvent.click(await within(modal).findByTestId('root-admin-sport-event-link-option-mock-weekend'));
    fireEvent.click(within(modal).getByTestId('root-admin-sport-event-link-modal-apply'));

    expect(await within(modal).findByText('This provider does not cover this sport.')).toBeInTheDocument();
  });

  it('asks the catalog for events from the start date with no end bound when the tournament has no end date', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({ data: { event: tournament({ endDate: null }) } });
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [] } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-link-open'));

    await waitFor(() => expect(listProviderCatalogEventsMock).toHaveBeenCalled());
    const { query } = listProviderCatalogEventsMock.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(query).toMatchObject({ sport: 'GOLF', from: '2026-05-07T12:00:00.000Z' });
    expect(query).not.toHaveProperty('to');
    expect(
      await screen.findByText('No provider events fall in this tournament’s date window.'),
    ).toBeInTheDocument();
  });

  it('closes the score-source picker from its close button without linking', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({ data: { providers: [] } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-link-open'));
    const modal = await screen.findByTestId('root-admin-sport-event-link-modal');
    expect(await within(modal).findByText('No provider is registered for golf.')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /^Close / }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-sport-event-link-modal')).not.toBeInTheDocument(),
    );
    expect(linkEventScoreSourceMock).not.toHaveBeenCalled();
  });


  describe('a linked score source', () => {
    function seedLinked() {
      seedDefaults();
      getEventMock.mockResolvedValue({
        data: {
          event: tournament({ syncScope: 'SCORES_ONLY', providerId: 'mock-contest-feed', externalId: 'mock-weekend' }),
        },
      });
      listProvidersMock.mockResolvedValue({
        data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] }] },
      });
    }

    it('shows the server\'s reason in the confirmation when unlinking the score source is refused', async () => {
      seedLinked();
      unlinkEventScoreSourceMock.mockResolvedValue(
        refusal('SPORT_EVENT_NOT_FOUND', 'Sport event evt-1 was not found.', 404),
      );
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-sport-event-unlink-open'));
      fireEvent.click(await screen.findByTestId('root-admin-sport-event-unlink-confirm'));

      expect(await screen.findByText('Event not found.')).toBeInTheDocument();
    });

    it('closes the unlink confirmation from its close button without unlinking', async () => {
      seedLinked();
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-sport-event-unlink-open'));
      const modal = await screen.findByTestId('root-admin-sport-event-unlink-modal');
      fireEvent.click(within(modal).getByRole('button', { name: /^Close / }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-sport-event-unlink-modal')).not.toBeInTheDocument(),
      );
      expect(unlinkEventScoreSourceMock).not.toHaveBeenCalled();
    });

  });

  it('opens the provider picker again without an earlier refusal still showing in it', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'feed-a', sportsCovered: ['GOLF'], primaryForSports: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({
      data: {
        events: [{
          externalId: 'weekend-open',
          name: 'Weekend Open',
          startDate: '2026-05-07T12:00:00.000Z',
          endDate: '2026-05-10T22:00:00.000Z',
          status: 'SCHEDULED',
        }],
      },
    });
    linkEventScoreSourceMock.mockResolvedValue(refusal('PROVIDER_EVENT_NOT_FOUND', 'Provider feed-a has no event weekend-open.', 404));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-link-open'));
    const modal = await screen.findByTestId('root-admin-sport-event-link-modal');
    fireEvent.click(await within(modal).findByTestId('root-admin-sport-event-link-option-weekend-open'));
    fireEvent.click(within(modal).getByTestId('root-admin-sport-event-link-modal-apply'));
    expect(await within(modal).findByText('The provider has no such event.')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /^Close / }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-sport-event-link-modal')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('root-admin-sport-event-link-open'));
    const reopened = await screen.findByTestId('root-admin-sport-event-link-modal');
    expect(within(reopened).queryByText('The provider has no such event.')).not.toBeInTheDocument();
  });
});
