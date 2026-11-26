import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateSportEventRequest,
  CreateTestSlotRequest,
  SportLeaguePhaseDefinitionDto,
  SportLeagueSeasonDto,
  SportLeagueSeasonCompetitionSlotDto,
} from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventCreatePage } from './root-admin-sport-event-create-page';
import { testEventSlotsOf } from './sport-event-edition';
import { sportEventFixture, sportLeagueFixture, sportsQueryClient } from './sport-test-fixtures';

// /manage/sports/golf/events/new: a test event is made on a free test slot of its tour's current
// Season (#2004), and a test slot can be added there first.

const {
  createEventMock,
  createTestSlotMock,
  getSportLeagueStructureMock,
  listSportLeagueSeasonsMock,
  listSportLeaguesMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return {
    createEventMock: vi.fn(),
    createTestSlotMock: vi.fn(),
    getSportLeagueStructureMock: vi.fn(),
    listSportLeagueSeasonsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createEvent: createEventMock,
  createTestSlot: createTestSlotMock,
  getSportLeagueStructure: getSportLeagueStructureMock,
  listSportLeagueSeasons: listSportLeagueSeasonsMock,
  listSportLeagues: listSportLeaguesMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function slot(id: string, overrides: Partial<SportLeagueSeasonCompetitionSlotDto> = {}): SportLeagueSeasonCompetitionSlotDto {
  return {
    id, slotDefinitionId: 'def-masters', key: 'MASTERS', slotKind: 'TOURNAMENT', weekNumber: null, name: 'The Masters',
    startsAt: '2026-04-09T12:00:00.000Z', endsAt: '2026-04-12T22:00:00.000Z', status: 'SCHEDULED',
    seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED', isTestData: true, label: `QA ${id}`, window: null, sportEventId: null, takesTestEvent: true, placedByWindow: false, needsDates: false, ...overrides,
  };
}

function season(id: string, isCurrent: boolean, slots: SportLeagueSeasonCompetitionSlotDto[]): SportLeagueSeasonDto {
  return {
    id, name: id, championshipYear: 2026, startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-12-31T23:59:59.999Z',
    isCurrent, providerMappings: [], slotsNeedingDates: 0, phases: [{
      id: `phase-${id}`, phase: 'REGULAR', isSynced: true, status: 'SCHEDULED',
      competitions: [{ id: `competition-${id}`, sportLeagueCompetitionId: 'competition-def', code: 'REGULAR', orderIndex: 1, status: 'SCHEDULED', championParticipantId: null, slots, slotsNeedingDates: 0 }],
    }],
  };
}

const SEASONS = [
  season('season-2026', true, [
    slot('free'),
    slot('taken', { sportEventId: 'event-on-it', takesTestEvent: false }),
    slot('synced', { isTestData: false, label: null, takesTestEvent: false }),
  ]),
  season('season-2025', false, [slot('last-year', { takesTestEvent: false })]),
];

const STRUCTURE: SportLeaguePhaseDefinitionDto[] = [{
  id: 'phase-def', phase: 'REGULAR', isSynced: true,
  competitions: [{ id: 'competition-def', code: 'REGULAR', orderIndex: 1, slots: [{ id: 'def-masters', key: 'MASTERS', slotKind: 'TOURNAMENT', weekNumber: null, name: 'The Masters' }] }],
} as unknown as SportLeaguePhaseDefinitionDto];

function renderPage(
  entry = '/manage/sports/golf/events/new?sportLeagueId=league-1',
  tours = [sportLeagueFixture({ id: 'league-1' }), sportLeagueFixture({ id: 'league-2', name: 'LPGA Tour' })],
  seasons: SportLeagueSeasonDto[] = SEASONS,
) {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: tours } });
  listSportLeagueSeasonsMock.mockResolvedValue({ data: { seasons } });
  getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
  const queryClient = sportsQueryClient(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<RootAdminSportEventCreatePage />} path="/manage/sports/:sport/events/new" />
          <Route element={<div data-testid="tournament-home">Home</div>} path="/manage/sports/:sport/events/:eventId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function slotOptions(): Promise<string[]> {
  const select = await screen.findByTestId('root-admin-sport-event-create-slot');
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
  return within(select).getAllByRole<HTMLOptionElement>('option').map((option) => option.value);
}

describe('RootAdminSportEventCreatePage', () => {
  afterEach(() => {
    createEventMock.mockReset();
    createTestSlotMock.mockReset();
  });

  it('blocks creation, with no link to make a tour, when no active golf tour exists', async () => {
    renderPage('/manage/sports/golf/events/new', [sportLeagueFixture({ id: 'league-1', isActive: false })]);

    expect(await screen.findByText('No active tour for a tournament')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-event-create-tours-link')).not.toBeInTheDocument();
  });

  it('defaults the only active tour when the URL names none, and asks for no dates or rounds: they are the slot\'s and the tour\'s', async () => {
    renderPage('/manage/sports/golf/events/new', [sportLeagueFixture({ id: 'league-1' })]);

    await waitFor(() => expect(screen.getByTestId('root-admin-sport-event-create-tour')).toHaveValue('league-1'));
    expect(screen.queryByTestId('root-admin-sport-event-create-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-event-create-rounds')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-event-create-header')).toHaveTextContent('New test tournament');
  });

  it('offers only the current Season\'s test slots that no event covers yet', async () => {
    renderPage();

    expect(await slotOptions()).toEqual(['', 'free']);
    expect(listSportLeagueSeasonsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'league-1' } }));
  });

  it('reads the test slots of the tour picked from the list, not the one the URL named', async () => {
    renderPage();
    await slotOptions();

    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-tour'), { target: { value: 'league-2' } });

    await waitFor(() => expect(listSportLeagueSeasonsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'league-2' } })));
    expect(screen.getByTestId('root-admin-sport-event-create-tour')).toHaveValue('league-2');
  });

  it('offers exactly the slots the API says take a test event, and none it says do not', () => {
    expect(testEventSlotsOf(SEASONS).map((each) => each.id)).toEqual(['free']);
    expect(testEventSlotsOf([season('old', false, [slot('a', { takesTestEvent: false })])])).toEqual([]);
  });

  it('says a tour with no current Season has no test slots, and offers no test slot form', async () => {
    renderPage('/manage/sports/golf/events/new?sportLeagueId=league-1', [sportLeagueFixture({ id: 'league-1', currentSeasonId: null })], []);

    expect(await screen.findByTestId('root-admin-sport-event-create-no-season')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-test-slot-create')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-event-create-slot')).toBeDisabled();
  });

  it('refuses to submit without a test slot, naming what is missing', async () => {
    renderPage();
    await slotOptions();

    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-name'), { target: { value: 'Spring Classic' } });
    fireEvent.click(screen.getByTestId('root-admin-sport-event-create-submit'));

    expect(await screen.findByText('Choose a test slot')).toBeInTheDocument();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it('creates the test event on the chosen slot with its name, venue and location, and navigates to it', async () => {
    createEventMock.mockResolvedValue({ data: { event: sportEventFixture({ id: 'new-tour' }) } });
    renderPage();
    await slotOptions();

    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-slot'), { target: { value: 'free' } });
    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-name'), { target: { value: 'Spring Classic' } });
    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-venue'), { target: { value: 'Augusta National' } });
    fireEvent.click(screen.getByTestId('root-admin-sport-event-create-auto-lifecycle'));
    fireEvent.click(screen.getByTestId('root-admin-sport-event-create-submit'));

    await waitFor(() => expect(createEventMock).toHaveBeenCalledTimes(1));
    const body = (createEventMock.mock.calls[0][0] as { body: CreateSportEventRequest }).body;
    expect(body).toEqual({ seasonSlotId: 'free', name: 'Spring Classic', venue: 'Augusta National', autoLifecycleEnabled: false });
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });

  it('shows a slot another create took first as its own refusal, not a generic failure', async () => {
    createEventMock.mockResolvedValue({ error: { error: { code: 'SEASON_SLOT_TAKEN', message: 'taken' } }, response: { status: 409 } });
    renderPage();
    await slotOptions();

    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-slot'), { target: { value: 'free' } });
    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-name'), { target: { value: 'The Masters' } });
    fireEvent.click(screen.getByTestId('root-admin-sport-event-create-submit'));

    expect(await screen.findByText('That slot already has an event.')).toBeInTheDocument();
  });

  it('adds a test slot of one of the tour\'s slot definitions to its current Season, then picks it once the Season lists it', async () => {
    createTestSlotMock.mockResolvedValue({ data: { slot: slot('added') } });
    renderPage();
    await slotOptions();
    await waitFor(() => expect(within(screen.getByTestId('root-admin-test-slot-create-definition')).getAllByRole('option')).toHaveLength(2));

    listSportLeagueSeasonsMock.mockResolvedValue({ data: { seasons: [season('season-2026', true, [slot('free'), slot('added')])] } });
    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-definition'), { target: { value: 'def-masters' } });
    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-label'), { target: { value: 'QA B' } });
    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-start'), { target: { value: '2026-04-09T08:00' } });
    fireEvent.click(screen.getByTestId('root-admin-test-slot-create-submit'));

    await waitFor(() => expect(createTestSlotMock).toHaveBeenCalledTimes(1));
    const call = createTestSlotMock.mock.calls[0][0] as { path: { sportLeagueId: string }; body: CreateTestSlotRequest };
    expect(call.path).toEqual({ sportLeagueId: 'league-1' });
    expect(call.body).toMatchObject({ slotDefinitionId: 'def-masters', label: 'QA B' });
    expect(call.body.startsAt).toContain('2026-04-09T');
    expect(call.body).not.toHaveProperty('endsAt');
    await waitFor(() => expect(screen.getByTestId('root-admin-sport-event-create-slot')).toHaveValue('added'));
  });

  it('shows a test slot label the Season already has as its own refusal', async () => {
    createTestSlotMock.mockResolvedValue({ error: { error: { code: 'TEST_SLOT_LABEL_TAKEN', message: 'taken' } }, response: { status: 409 } });
    renderPage();
    await slotOptions();
    await waitFor(() => expect(within(screen.getByTestId('root-admin-test-slot-create-definition')).getAllByRole('option')).toHaveLength(2));

    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-definition'), { target: { value: 'def-masters' } });
    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-label'), { target: { value: 'QA free' } });
    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-start'), { target: { value: '2026-04-09T08:00' } });
    fireEvent.change(screen.getByTestId('root-admin-test-slot-create-end'), { target: { value: '2026-04-12T18:00' } });
    fireEvent.click(screen.getByTestId('root-admin-test-slot-create-submit'));

    expect(await screen.findByText('This Season already has a test slot with that label for that slot.')).toBeInTheDocument();
    expect((createTestSlotMock.mock.calls[0][0] as { body: CreateTestSlotRequest }).body.endsAt).toContain('2026-04-12T');
  });

  it('offers only the test event form, with no way to browse or link a provider\'s events', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-sport-event-create-header')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Browse provider events' })).not.toBeInTheDocument();
  });
});
