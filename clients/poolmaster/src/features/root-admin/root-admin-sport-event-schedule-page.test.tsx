import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateSportEventRoundsRequest } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { EventRoundsTab } from './event-rounds-tab';
import { RootAdminSportEventSchedulePage } from './root-admin-sport-event-schedule-page';
import { EventTabOutlet } from './test/event-tab-outlet';
import { sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';

// plans/124 §6.3 — an event's round schedule editor, opened from the Rounds and matches tab
// (pool-master-3dg, #1890).

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

function renderPage(path = '/manage/sports/golf/events/tour-1/rounds') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<EventTabOutlet />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventRoundsTab />} path="rounds" />
            <Route element={<RootAdminSportEventSchedulePage />} path="schedule" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function refusal(code: string, message: string, status = 422) {
  return { error: { error: { code, message } }, response: { status } };
}

describe('The round schedule editor, reached from the Rounds and matches tab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-3dg saves an edited round schedule', async () => {
    seedDefaults();
    updateEventRoundsMock.mockResolvedValue({
      data: { rounds: [] },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-sport-event-schedule-page');
    fireEvent.change(
      within(modal).getByTestId('root-admin-sport-event-round-1-date'),
      { target: { value: '2026-05-09T09:00' } },
    );
    fireEvent.click(within(modal).getByTestId('root-admin-sport-event-rounds-save'));

    await waitFor(() =>
      expect(updateEventRoundsMock).toHaveBeenCalledTimes(1),
    );
    const body = (updateEventRoundsMock.mock.calls[0][0] as {
      body: UpdateSportEventRoundsRequest;
    }).body;
    expect(body.rounds[0]).toMatchObject({ roundNumber: 1 });
    expect(body.rounds[0].scheduledDate).toContain('2026-05-09T');
  });

  it('clears a round\'s end time when the admin blanks it in the schedule editor, rather than keeping the old one', async () => {
    seedDefaults();
    updateEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-sport-event-schedule-page');
    const roundOneEnd = within(modal).getByLabelText('Round 1 end');
    expect(roundOneEnd).not.toHaveValue('');
    fireEvent.change(roundOneEnd, { target: { value: '' } });
    fireEvent.click(within(modal).getByTestId('root-admin-sport-event-rounds-save'));

    await waitFor(() => expect(updateEventRoundsMock).toHaveBeenCalledTimes(1));
    const body = (updateEventRoundsMock.mock.calls[0][0] as {
      body: UpdateSportEventRoundsRequest;
    }).body;
    expect(body.rounds[0]).toHaveProperty('scheduledEndAt', null);
  });

  it('shows the server\'s reason inside the schedule editor when saving the rounds is refused', async () => {
    seedDefaults();
    updateEventRoundsMock.mockResolvedValue(refusal('VALIDATION_ERROR', 'Round 2 must start after round 1.'));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-sport-event-schedule-page');
    fireEvent.click(within(modal).getByTestId('root-admin-sport-event-rounds-save'));

    expect(await within(modal).findByText('Round 2 must start after round 1.')).toBeInTheDocument();
  });

  it('returns to the Rounds and matches tab from the round schedule\'s Cancel without saving', async () => {
    seedDefaults();
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-sport-event-rounds-edit'));
    const modal = await screen.findByTestId('root-admin-sport-event-schedule-page');
    fireEvent.click(within(modal).getByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-event-rounds-tab')).toBeInTheDocument();
    expect(updateEventRoundsMock).not.toHaveBeenCalled();
  });

  it('tells the admin there is nothing to schedule, with no Save, when the tournament has no rounds', async () => {
    seedDefaults();
    listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    renderPage('/manage/sports/golf/events/tour-1/schedule');

    expect(await screen.findByText('This tournament has no rounds to schedule yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-event-rounds-save')).not.toBeInTheDocument();
  });

  it('shows the server\'s reason as a load error, with no Save, when the round schedule cannot be loaded', async () => {
    seedDefaults();
    listEventRoundsMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The round store is unavailable.', 500));
    renderPage('/manage/sports/golf/events/tour-1/schedule');

    const alert = await screen.findByTestId('root-admin-sport-event-schedule-error');
    expect(within(alert).getByText('The round store is unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-event-rounds-save')).not.toBeInTheDocument();
  });
});
