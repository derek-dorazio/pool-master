import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateSportEventRoundsRequest } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentEditPage } from './root-admin-golf-tournament-edit-page';
import { RootAdminGolfTournamentHomePage } from './root-admin-golf-tournament-home-page';
import { RootAdminGolfTournamentSchedulePage } from './root-admin-golf-tournament-schedule-page';
import { sportEventFixture, sportLeagueFixture } from './golf-test-fixtures';

// plans/124 §6.3 — tournament Overview: header + details + workflow rail + score source
// (pool-master-3dg).

const {
  listSportLeaguesMock,
  getEventMock,
  getEventLiveSimulationMock,
  listEventRoundsMock,
  linkEventScoreSourceMock,
  listProviderCatalogEventsMock,
  listProvidersMock,
  releaseEventMock,
  startEventLiveSimulationMock,
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
    getEventLiveSimulationMock: vi.fn(),
    listEventRoundsMock: vi.fn(),
    linkEventScoreSourceMock: vi.fn(),
    listProviderCatalogEventsMock: vi.fn(),
    listProvidersMock: vi.fn(),
    releaseEventMock: vi.fn(),
    startEventLiveSimulationMock: vi.fn(),
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
  getEventLiveSimulation: getEventLiveSimulationMock,
  listEventRounds: listEventRoundsMock,
  linkEventScoreSource: linkEventScoreSourceMock,
  listProviderCatalogEvents: listProviderCatalogEventsMock,
  listProviders: listProvidersMock,
  releaseEvent: releaseEventMock,
  startEventLiveSimulation: startEventLiveSimulationMock,
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
    eventYear: 2026,
    sportLeagueId: 'league-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    loadedParticipantCount: 120,
    tierCount: 6,
    contestCount: 0,
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

function renderPage(path = '/manage/golf/tournaments/tour-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentHomePage />}
            path="/manage/golf/tournaments/:eventId"
          />
          <Route
            element={<RootAdminGolfTournamentEditPage />}
            path="/manage/golf/tournaments/:eventId/edit"
          />
          <Route
            element={<RootAdminGolfTournamentSchedulePage />}
            path="/manage/golf/tournaments/:eventId/schedule"
          />
          <Route
            element={<div data-testid="tournament-subpage" />}
            path="/manage/golf/tournaments/:eventId/:view"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminGolfTournamentHomePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('shows the tournament header and sub-menu, details, workflow rail and auto-lifecycle hint, and the sub-menu opens Tiers', async () => {
    seedDefaults();
    renderPage();

    expect(await screen.findByText('Rolling Weekend Invitational')).toBeInTheDocument();
    // plans/147 — the tour (linked) and the event year, where the season used to be.
    expect(await screen.findByTestId('root-admin-golf-tournament-home-tour-link')).toHaveTextContent('PGA Tour');
    expect(screen.getByTestId('root-admin-golf-tournament-home-tour-link')).toHaveAttribute('href', '/manage/golf/leagues/league-1');
    expect(screen.getByText('Event year')).toBeInTheDocument();

    const rail = screen.getByTestId('root-admin-golf-tournament-workflow-rail');
    expect(within(rail).getByText('Draft')).toBeInTheDocument();
    expect(within(rail).getByText('Released for contests')).toHaveTextContent('current');
    expect(within(rail).getByText('Completed')).toBeInTheDocument();
    // Released already, so there is nothing to release.
    expect(screen.queryByTestId('root-admin-golf-tournament-release')).not.toBeInTheDocument();

    // SCHEDULED + autoLifecycleEnabled + round 1 in the schedule -> hint present.
    expect(
      screen.getByTestId('root-admin-golf-tournament-auto-hint'),
    ).toHaveTextContent('In Progress');

    // One header for every tournament page: name, status, year and counts, then the sub-menu.
    expect(screen.getByRole('heading', { name: 'Rolling Weekend Invitational', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tournament-counts')).toHaveTextContent('120 golfers · 6 tiers');
    expect(screen.getByTestId('root-admin-golf-tournament-menu-overview')).toBeChecked();
    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-menu-tiers'));
    expect(await screen.findByTestId('tournament-subpage')).toBeInTheDocument();
  });

  describe('Release for contests', () => {
    // The release checks compare against the start time, so the clock is pinned before it.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('lists what is missing and keeps the button disabled while a draft has untiered golfers', async () => {
      seedDefaults();
      getEventMock.mockResolvedValue({
        data: { event: tournament({ status: 'DRAFT', allowedTransitions: ['CANCELLED'], untieredParticipantCount: 3 }) },
      });
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-release-missing')).toHaveTextContent(
        'Put the 3 active golfers without a tier into tiers.',
      );
      expect(screen.getByTestId('root-admin-golf-tournament-release')).toBeDisabled();
    });

    it('releases a ready draft after the admin confirms', async () => {
      seedDefaults();
      getEventMock.mockResolvedValue({
        data: { event: tournament({ status: 'DRAFT', allowedTransitions: ['CANCELLED'] }) },
      });
      releaseEventMock.mockResolvedValue({ data: { event: tournament({ status: 'SCHEDULED' }) } });
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-release'));
      const modal = await screen.findByTestId('root-admin-golf-tournament-release-modal');
      fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-release-confirm'));

      await waitFor(() => expect(releaseEventMock).toHaveBeenCalledWith({ path: { eventId: 'tour-1' } }));
    });

    it('explains a refused release in plain words', async () => {
      seedDefaults();
      getEventMock.mockResolvedValue({
        data: { event: tournament({ status: 'DRAFT', allowedTransitions: ['CANCELLED'] }) },
      });
      releaseEventMock.mockResolvedValue({
        error: { error: { code: 'SPORT_EVENT_ALREADY_STARTED', message: 'Sport event has already started.' } },
      });
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-release'));
      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-release-confirm'));

      expect(
        await screen.findByText('This tournament has already started, so it can no longer be released.'),
      ).toBeInTheDocument();
    });
  });

  it('pool-master-3dg confirms and applies an allowed lifecycle transition', async () => {
    seedDefaults();
    transitionEventMock.mockResolvedValue({
      data: { event: tournament({ status: 'IN_PROGRESS' }) },
    });
    renderPage();

    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-transition-IN_PROGRESS'),
    );

    const modal = await screen.findByTestId('root-admin-golf-tournament-transition-modal');
    fireEvent.click(
      within(modal).getByTestId('root-admin-golf-tournament-transition-confirm'),
    );

    await waitFor(() =>
      expect(transitionEventMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { toStatus: 'IN_PROGRESS' },
      }),
    );
  });

  it('pool-master-3dg opens the score-source picker for an unlinked tournament', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
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

    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-link-open'));

    const modal = await screen.findByTestId('root-admin-golf-tournament-link-modal');
    fireEvent.click(
      await within(modal).findByTestId(
        'root-admin-golf-tournament-link-option-mock-weekend',
      ),
    );
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-link-modal-apply'));

    await waitFor(() =>
      expect(linkEventScoreSourceMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { providerId: 'mock-contest-feed', externalId: 'mock-weekend' },
      }),
    );
  });

  it('pool-master-3dg saves edited summary details through RHF + updateEvent', async () => {
    seedDefaults();
    updateEventMock.mockResolvedValue({
      data: { event: tournament({ name: 'Renamed Invitational' }) },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    fireEvent.change(within(modal).getByDisplayValue('Rolling Weekend Invitational'), {
      target: { value: 'Renamed Invitational' },
    });
    fireEvent.click(
      within(modal).getByTestId('root-admin-golf-tournament-edit-save'),
    );

    await waitFor(() =>
      expect(updateEventMock).toHaveBeenCalledTimes(1),
    );
    expect(updateEventMock.mock.calls[0][0]).toMatchObject({
      path: { eventId: 'tour-1' },
      body: { name: 'Renamed Invitational', rounds: 4 },
    });
  });

  it('saves the par per round an admin enters, and sends null when it is left blank', async () => {
    seedDefaults();
    updateEventMock.mockResolvedValue({ data: { event: tournament({ roundsPar: 72 }) } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    expect(within(modal).getByTestId('root-admin-golf-tournament-edit-rounds-par')).toHaveValue(null);
    fireEvent.change(within(modal).getByTestId('root-admin-golf-tournament-edit-rounds-par'), {
      target: { value: '72' },
    });
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-edit-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect(updateEventMock.mock.calls[0][0]).toMatchObject({ body: { roundsPar: 72 } });

    // Saving returns to Overview; Edit opens the form again from the tournament as read.
    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const reopened = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    fireEvent.click(within(reopened).getByTestId('root-admin-golf-tournament-edit-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(2));
    expect(updateEventMock.mock.calls[1][0]).toMatchObject({ body: { roundsPar: null } });
  });

  it('refuses a par per round outside 60 to 80 before saving', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    fireEvent.change(within(modal).getByTestId('root-admin-golf-tournament-edit-rounds-par'), {
      target: { value: '85' },
    });

    expect(await within(modal).findByText('Par is a whole number from 60 to 80, or blank')).toBeInTheDocument();
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-edit-save'));
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it('pool-master-3dg blocks the edit save when a required field is cleared', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    fireEvent.change(within(modal).getByDisplayValue('Rolling Weekend Invitational'), {
      target: { value: '' },
    });
    fireEvent.click(
      within(modal).getByTestId('root-admin-golf-tournament-edit-save'),
    );

    await screen.findByText('Name is required');
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it('pool-master-3dg confirms the manage-lifecycle-manually toggle', async () => {
    seedDefaults();
    updateEventMock.mockResolvedValue({
      data: { event: tournament({ autoLifecycleEnabled: false }) },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-auto-toggle'));
    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-auto-confirm'),
    );

    await waitFor(() =>
      expect(updateEventMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { autoLifecycleEnabled: false },
      }),
    );
  });

  it('pool-master-3dg saves an edited round schedule', async () => {
    seedDefaults();
    updateEventRoundsMock.mockResolvedValue({
      data: { rounds: [] },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-schedule-page');
    fireEvent.change(
      within(modal).getByTestId('root-admin-golf-tournament-round-1-date'),
      { target: { value: '2026-05-09T09:00' } },
    );
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-rounds-save'));

    await waitFor(() =>
      expect(updateEventRoundsMock).toHaveBeenCalledTimes(1),
    );
    const body = (updateEventRoundsMock.mock.calls[0][0] as {
      body: UpdateSportEventRoundsRequest;
    }).body;
    expect(body.rounds[0]).toMatchObject({ roundNumber: 1 });
    expect(body.rounds[0].scheduledDate).toContain('2026-05-09T');
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
      await screen.findByTestId('root-admin-golf-tournament-unlink-open'),
    );
    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-unlink-confirm'),
    );

    await waitFor(() =>
      expect(unlinkEventScoreSourceMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
      }),
    );
  });
  describe('live simulation', () => {
    function seedLinked(supportsLiveSimulation: boolean) {
      seedDefaults();
      getEventMock.mockResolvedValue({
        data: {
          event: tournament({ syncScope: 'SCORES_ONLY', providerId: 'mock-contest-feed', externalId: 'mock-weekend' }),
        },
      });
      listProvidersMock.mockResolvedValue({
        data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], supportsLiveSimulation }] },
      });
      getEventLiveSimulationMock.mockResolvedValue(notRunning);
    }

    const notRunning = {
      error: { error: { code: 'LIVE_SIMULATION_NOT_RUNNING', message: 'No live simulation is running for this event.' } },
      response: { status: 404 },
    };

    function simulationStatus(currentRound: number) {
      return {
        data: {
          sportEventId: 'tour-1',
          startsAt: '2026-10-06T12:00:00.000Z',
          endsAt: '2026-10-06T13:20:00.000Z',
          minutesPerRound: 20,
          phase: 'IN_PROGRESS',
          currentRound,
        },
      };
    }

    it('starts the score source\'s live simulation and says which round is under way', async () => {
      seedLinked(true);
      startEventLiveSimulationMock.mockResolvedValue(simulationStatus(1));
      renderPage();

      const start = await screen.findByTestId('root-admin-golf-tournament-live-simulation-start');
      await waitFor(() => expect(getEventLiveSimulationMock).toHaveBeenCalled());
      expect(screen.queryByTestId('root-admin-golf-tournament-live-simulation-status')).not.toBeInTheDocument();
      getEventLiveSimulationMock.mockResolvedValue(simulationStatus(1));
      fireEvent.click(start);

      await waitFor(() =>
        expect(startEventLiveSimulationMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'tour-1' }, body: {} })),
      );
      expect(await screen.findByTestId('root-admin-golf-tournament-live-simulation-status'))
        .toHaveTextContent('Round 1 of 4 is under way, 20 minutes per round');
    });

    it('shows a simulation that is already running when the page loads, without pressing start', async () => {
      seedLinked(true);
      getEventLiveSimulationMock.mockResolvedValue(simulationStatus(3));
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-live-simulation-status'))
        .toHaveTextContent('Round 3 of 4 is under way');
      expect(getEventLiveSimulationMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'tour-1' } }));
      expect(startEventLiveSimulationMock).not.toHaveBeenCalled();
    });

    it('links an unlinked tournament to its own simulated event, sandbox-<event id>, in one click', async () => {
      seedDefaults();
      listProvidersMock.mockResolvedValue({
        data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], supportsLiveSimulation: true }] },
      });
      linkEventScoreSourceMock.mockResolvedValue({
        data: { event: tournament({ syncScope: 'SCORES_ONLY', providerId: 'mock-contest-feed', externalId: 'sandbox-tour-1' }) },
      });
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-link-simulated'));

      await waitFor(() =>
        expect(linkEventScoreSourceMock).toHaveBeenCalledWith({
          path: { eventId: 'tour-1' },
          body: { providerId: 'mock-contest-feed', externalId: 'sandbox-tour-1' },
        }),
      );
    });

    it('offers no simulated-event link when no golf provider can simulate', async () => {
      seedDefaults();
      listProvidersMock.mockResolvedValue({
        data: { providers: [{ providerId: 'real-golf', sportsCovered: ['GOLF'], supportsLiveSimulation: false }] },
      });
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-link-open')).toBeInTheDocument();
      await waitFor(() => expect(listProvidersMock).toHaveBeenCalled());
      expect(screen.queryByTestId('root-admin-golf-tournament-link-simulated')).not.toBeInTheDocument();
    });

    it('offers no live simulation when the linked provider cannot simulate', async () => {
      seedLinked(false);
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-unlink-open')).toBeInTheDocument();
      await waitFor(() => expect(listProvidersMock).toHaveBeenCalled());
      expect(screen.queryByTestId('root-admin-golf-tournament-live-simulation-start')).not.toBeInTheDocument();
      expect(getEventLiveSimulationMock).not.toHaveBeenCalled();
    });

    it('shows the server\'s reason when the simulation is refused', async () => {
      seedLinked(true);
      startEventLiveSimulationMock.mockResolvedValue({
        error: { error: { code: 'PROVIDER_EVENT_NOT_FOUND', message: 'Provider mock-contest-feed has no event mock-weekend.' } },
        response: { status: 404 },
      });
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-live-simulation-start'));

      expect(await screen.findByTestId('root-admin-golf-tournament-live-simulation-error'))
        .toHaveTextContent('Provider mock-contest-feed has no event mock-weekend.');
    });
  });
});

describe('clearing an optional date and refused links on Overview', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('clears the end date when the admin blanks it in Edit details, rather than keeping the old one', async () => {
    seedDefaults();
    updateEventMock.mockResolvedValue({ data: { event: tournament({ endDate: undefined }) } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    const endInput = within(modal).getByLabelText('Ends');
    expect(endInput).not.toHaveValue('');
    fireEvent.change(endInput, { target: { value: '' } });
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-edit-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect((updateEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body)
      .toHaveProperty('endDate', null);
  });

  it('clears a round\'s end time when the admin blanks it in the schedule editor, rather than keeping the old one', async () => {
    seedDefaults();
    updateEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-schedule-page');
    const roundOneEnd = within(modal).getByLabelText('Round 1 end');
    expect(roundOneEnd).not.toHaveValue('');
    fireEvent.change(roundOneEnd, { target: { value: '' } });
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-rounds-save'));

    await waitFor(() => expect(updateEventRoundsMock).toHaveBeenCalledTimes(1));
    const body = (updateEventRoundsMock.mock.calls[0][0] as {
      body: UpdateSportEventRoundsRequest;
    }).body;
    expect(body.rounds[0]).toHaveProperty('scheduledEndAt', null);
  });

  it('shows the server\'s reason inside the picker when linking a provider event is refused', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
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

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-link-open'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-link-modal');
    fireEvent.click(await within(modal).findByTestId('root-admin-golf-tournament-link-option-mock-weekend'));
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-link-modal-apply'));

    expect(await within(modal).findByText('Provider mock-contest-feed does not cover GOLF.')).toBeInTheDocument();
  });
});

describe('Overview blocks: empty values, refusals and closing dialogs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  function refusal(code: string, message: string, status = 422) {
    return { error: { error: { code, message } }, response: { status } };
  }

  it('shows the server\'s reason in place of the page when the tournament cannot be loaded', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue(refusal('SPORT_EVENT_NOT_FOUND', 'Sport event tour-1 was not found.', 404));
    renderPage();

    expect(await screen.findByText('Sport event tour-1 was not found.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tournament-home-edit')).not.toBeInTheDocument();
  });

  it('tells the admin to load the field when a linked tournament has no golfers yet, and links to Field', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({
      data: { event: tournament({ syncScope: 'SCORES_ONLY', providerId: 'mock-contest-feed', externalId: 'mock-weekend', loadedParticipantCount: 0 }) },
    });
    listProvidersMock.mockResolvedValue({ data: { providers: [] } });
    renderPage();

    expect(await screen.findByText('The participant field is not loaded yet')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tournament-home-load-field')).toHaveAttribute(
      'href',
      '/manage/golf/tournaments/tour-1/field',
    );
  });

  it('reads "Not set" for a missing venue, location and round count, and "Open tour" when the tour is unknown', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({
      data: { event: tournament({ venue: null, location: null, rounds: null, sportLeagueId: 'league-unknown' }) },
    });
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-tournament-home-tour-link')).toHaveTextContent('Open tour');
    expect(screen.getAllByText('Not set')).toHaveLength(3);
  });

  it('sends a blank venue and location as null and defaults a missing round count to 1 when the details are saved', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({
      data: { event: tournament({ venue: 'Old Course', location: null, endDate: null, rounds: null }) },
    });
    updateEventMock.mockResolvedValue({ data: { event: tournament() } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    expect(within(modal).getByLabelText('Ends')).toHaveValue('');
    expect(within(modal).getByLabelText('Rounds')).toHaveValue(1);
    fireEvent.change(within(modal).getByLabelText('Venue'), { target: { value: '   ' } });
    await waitFor(() => expect(within(modal).getByTestId('root-admin-golf-tournament-edit-save')).toBeEnabled());
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-edit-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect((updateEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body).toMatchObject({
      venue: null,
      location: null,
      endDate: null,
      rounds: 1,
    });
  });

  it('shows the server\'s reason on Edit details when saving the details is refused, and stays on the form', async () => {
    seedDefaults();
    updateEventMock.mockResolvedValue(refusal('VALIDATION_ERROR', 'The end date must be after the start date.'));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-edit-save'));

    expect(await within(modal).findByText('The end date must be after the start date.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tournament-edit-page')).toBeInTheDocument();
  });

  it('returns to Overview from Edit details\' Cancel without saving', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-home-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-edit-page');
    fireEvent.click(within(modal).getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-golf-tournament-home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tournament-edit-page')).not.toBeInTheDocument();
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it('says no lifecycle transitions are available when the tournament allows none', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({
      data: { event: tournament({ status: 'COMPLETED', allowedTransitions: [] }) },
    });
    renderPage();

    expect(await screen.findByText(/No lifecycle transitions are available from/)).toHaveTextContent('Completed');
    expect(screen.queryByTestId('root-admin-golf-tournament-transition-CANCELLED')).not.toBeInTheDocument();
  });

  it('shows the server\'s reason in the confirmation when a lifecycle transition is refused', async () => {
    seedDefaults();
    transitionEventMock.mockResolvedValue(
      refusal('INVALID_STATUS_TRANSITION', 'Cannot move a scheduled tournament to In Progress before round 1.'),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-transition-IN_PROGRESS'));
    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-transition-confirm'));

    expect(
      await screen.findByText('Cannot move a scheduled tournament to In Progress before round 1.'),
    ).toBeInTheDocument();
  });

  it('closes the transition confirmation from its close button without changing the status', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-transition-CANCELLED'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-transition-modal');
    expect(within(modal).getByTestId('root-admin-golf-tournament-transition-confirm')).toHaveTextContent('Move to Cancelled');
    fireEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-golf-tournament-transition-modal')).not.toBeInTheDocument(),
    );
    expect(transitionEventMock).not.toHaveBeenCalled();
  });

  it('offers to turn automatic lifecycle back on when it is off, and sends autoLifecycleEnabled true', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({ data: { event: tournament({ autoLifecycleEnabled: false }) } });
    updateEventMock.mockResolvedValue({ data: { event: tournament({ autoLifecycleEnabled: true }) } });
    renderPage();

    const toggle = await screen.findByTestId('root-admin-golf-tournament-auto-toggle');
    expect(toggle).toHaveTextContent('Re-enable automatic lifecycle');
    expect(screen.getByText('Automatic lifecycle is off — every transition is manual.')).toBeInTheDocument();
    fireEvent.click(toggle);
    const confirm = await screen.findByTestId('root-admin-golf-tournament-auto-confirm');
    expect(confirm).toHaveTextContent('Turn on automatic lifecycle');
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(updateEventMock).toHaveBeenCalledWith({
        path: { eventId: 'tour-1' },
        body: { autoLifecycleEnabled: true },
      }),
    );
  });

  it('shows the server\'s reason when the automatic-lifecycle change is refused', async () => {
    seedDefaults();
    updateEventMock.mockResolvedValue(refusal('SPORT_EVENT_LOCKED', 'This tournament is locked.', 409));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-auto-toggle'));
    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-auto-confirm'));

    expect(await screen.findByText('This tournament is locked.')).toBeInTheDocument();
  });

  it('closes the automatic-lifecycle confirmation from its close button without saving', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-auto-toggle'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-auto-modal');
    fireEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-golf-tournament-auto-modal')).not.toBeInTheDocument(),
    );
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason in the Rounds card when the round schedule cannot be loaded', async () => {
    seedDefaults();
    listEventRoundsMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The round store is unavailable.', 500));
    renderPage();

    expect(await screen.findByText('The round store is unavailable.')).toBeInTheDocument();
  });

  it('says no rounds are recorded when the tournament has an empty round schedule', async () => {
    seedDefaults();
    listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    renderPage();

    expect(await screen.findByText('No rounds recorded yet.')).toBeInTheDocument();
  });

  it('shows the server\'s reason inside the schedule editor when saving the rounds is refused', async () => {
    seedDefaults();
    updateEventRoundsMock.mockResolvedValue(refusal('VALIDATION_ERROR', 'Round 2 must start after round 1.'));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-schedule-page');
    fireEvent.click(within(modal).getByTestId('root-admin-golf-tournament-rounds-save'));

    expect(await within(modal).findByText('Round 2 must start after round 1.')).toBeInTheDocument();
  });

  it('returns to Overview from the round schedule\'s Cancel without saving', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-schedule-page');
    fireEvent.click(within(modal).getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-golf-tournament-home-page')).toBeInTheDocument();
    expect(updateEventRoundsMock).not.toHaveBeenCalled();
  });

  it('tells the admin there is nothing to schedule, with no Save, when the tournament has no rounds', async () => {
    seedDefaults();
    listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    renderPage('/manage/golf/tournaments/tour-1/schedule');

    expect(await screen.findByText('This tournament has no rounds to schedule yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tournament-rounds-save')).not.toBeInTheDocument();
  });

  it('shows the server\'s reason as a load error, with no Save, when the round schedule cannot be loaded', async () => {
    seedDefaults();
    listEventRoundsMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The round store is unavailable.', 500));
    renderPage('/manage/golf/tournaments/tour-1/schedule');

    const alert = await screen.findByTestId('shared-error-state');
    expect(within(alert).getByText('The round store is unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tournament-rounds-save')).not.toBeInTheDocument();
  });

  it('closes the release confirmation from its close button without releasing the draft', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    seedDefaults();
    getEventMock.mockResolvedValue({
      data: { event: tournament({ status: 'DRAFT', allowedTransitions: ['CANCELLED'] }) },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-release'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-release-modal');
    fireEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-golf-tournament-release-modal')).not.toBeInTheDocument(),
    );
    expect(releaseEventMock).not.toHaveBeenCalled();
  });

  it('asks the catalog for events from the start date with no end bound when the tournament has no end date', async () => {
    seedDefaults();
    getEventMock.mockResolvedValue({ data: { event: tournament({ endDate: null }) } });
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [] } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-link-open'));

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

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-link-open'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-link-modal');
    expect(await within(modal).findByText('No provider is registered for golf.')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-golf-tournament-link-modal')).not.toBeInTheDocument(),
    );
    expect(linkEventScoreSourceMock).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason under the buttons when linking to a simulated event is refused', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], supportsLiveSimulation: true }] },
    });
    linkEventScoreSourceMock.mockResolvedValue(
      refusal('SPORT_EVENT_ALREADY_LINKED', 'This tournament is already linked to a score source.', 409),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-link-simulated'));

    expect(await screen.findByTestId('root-admin-golf-tournament-link-error')).toHaveTextContent(
      'This tournament is already linked to a score source.',
    );
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
        data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], supportsLiveSimulation: true }] },
      });
      getEventLiveSimulationMock.mockResolvedValue(
        refusal('LIVE_SIMULATION_NOT_RUNNING', 'No live simulation is running for this event.', 404),
      );
    }

    it('shows the server\'s reason in the confirmation when unlinking the score source is refused', async () => {
      seedLinked();
      unlinkEventScoreSourceMock.mockResolvedValue(
        refusal('SPORT_EVENT_IN_PROGRESS', 'A live tournament cannot be unlinked.', 409),
      );
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-unlink-open'));
      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-unlink-confirm'));

      expect(await screen.findByText('A live tournament cannot be unlinked.')).toBeInTheDocument();
    });

    it('closes the unlink confirmation from its close button without unlinking', async () => {
      seedLinked();
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-unlink-open'));
      const modal = await screen.findByTestId('root-admin-golf-tournament-unlink-modal');
      fireEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-golf-tournament-unlink-modal')).not.toBeInTheDocument(),
      );
      expect(unlinkEventScoreSourceMock).not.toHaveBeenCalled();
    });

    it('says when a finished simulation ended instead of naming a round', async () => {
      seedLinked();
      getEventLiveSimulationMock.mockResolvedValue({
        data: {
          sportEventId: 'tour-1',
          startsAt: '2026-05-01T12:00:00.000Z',
          endsAt: '2026-05-01T13:20:00.000Z',
          minutesPerRound: 20,
          phase: 'COMPLETED',
          currentRound: null,
        },
      });
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-live-simulation-status'))
        .toHaveTextContent(/^Simulation finished at /);
    });

    it('says the simulation starts shortly while no round is under way yet', async () => {
      seedLinked();
      getEventLiveSimulationMock.mockResolvedValue({
        data: {
          sportEventId: 'tour-1',
          startsAt: '2026-05-01T12:00:00.000Z',
          endsAt: '2026-05-01T13:20:00.000Z',
          minutesPerRound: 20,
          phase: 'SCHEDULED',
          currentRound: null,
        },
      });
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-live-simulation-status'))
        .toHaveTextContent('Simulation starts shortly, 20 minutes per round');
    });

    it('shows the server\'s reason when the simulation status cannot be read', async () => {
      seedLinked();
      getEventLiveSimulationMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The simulation clock is unavailable.', 500));
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-live-simulation-status-error'))
        .toHaveTextContent('The simulation clock is unavailable.');
    });

    it('disables the start button and reads "Starting…" while the simulation start is in flight', async () => {
      seedLinked();
      startEventLiveSimulationMock.mockReturnValue(new Promise(() => undefined));
      renderPage();

      fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-live-simulation-start'));

      await waitFor(() =>
        expect(screen.getByTestId('root-admin-golf-tournament-live-simulation-start')).toHaveTextContent('Starting…'),
      );
      expect(screen.getByTestId('root-admin-golf-tournament-live-simulation-start')).toBeDisabled();
    });

    it('offers no live simulation when the provider list cannot be read', async () => {
      seedLinked();
      listProvidersMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'Provider registry unavailable.', 500));
      renderPage();

      expect(await screen.findByTestId('root-admin-golf-tournament-unlink-open')).toBeInTheDocument();
      await waitFor(() => expect(listProvidersMock).toHaveBeenCalled());
      expect(screen.queryByTestId('root-admin-golf-tournament-live-simulation')).not.toBeInTheDocument();
      expect(getEventLiveSimulationMock).not.toHaveBeenCalled();
    });
  });
  it('opens the provider picker without an earlier simulated-link refusal still showing in it', async () => {
    seedDefaults();
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'], supportsLiveSimulation: true }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [] } });
    linkEventScoreSourceMock.mockResolvedValue({
      error: { error: { code: 'PROVIDER_EVENT_NOT_FOUND', message: 'Simulated event refused.' } },
      response: { status: 404 },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-link-simulated'));
    expect(await screen.findByTestId('root-admin-golf-tournament-link-error')).toHaveTextContent('Simulated event refused.');

    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-link-open'));
    const modal = await screen.findByTestId('root-admin-golf-tournament-link-modal');
    expect(within(modal).queryByText('Simulated event refused.')).not.toBeInTheDocument();
  });
});
