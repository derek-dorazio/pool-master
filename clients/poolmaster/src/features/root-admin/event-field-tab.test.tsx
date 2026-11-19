import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { Toaster } from '@/features/shared/ui';
import { EventFieldTab } from './event-field-tab';
import { EventToolsTab } from './event-tools-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import {
  fieldEntryFixture,
  participantFixture,
  sportEventFixture,
  tierFixture,
  valuationFixture,
} from './sport-test-fixtures';

// plans/124 §6.3 — /manage/sports/golf/events/:eventId/field Field editor (pool-master-za4).

const {
  getEventMock,
  listEventParticipantsMock,
  listEventTiersMock,
  replaceEventTierAssignmentsMock,
  updateEventParticipantsMock,
  seedEventParticipantsMock,
  refreshEventParticipantsMock,
  addEventParticipantsMock,
  listSportLeaguesMock,
  listSportLeagueParticipantsMock,
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
    getEventMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    listEventTiersMock: vi.fn(),
    replaceEventTierAssignmentsMock: vi.fn(),
    updateEventParticipantsMock: vi.fn(),
    seedEventParticipantsMock: vi.fn(),
    refreshEventParticipantsMock: vi.fn(),
    addEventParticipantsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listSportLeagueParticipantsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventParticipants: listEventParticipantsMock,
  listEventTiers: listEventTiersMock,
  replaceEventTierAssignments: replaceEventTierAssignmentsMock,
  updateEventParticipants: updateEventParticipantsMock,
  seedEventParticipants: seedEventParticipantsMock,
  refreshEventParticipants: refreshEventParticipantsMock,
  addEventParticipants: addEventParticipantsMock,
  listSportLeagues: listSportLeaguesMock,
  listSportLeagueParticipants: listSportLeagueParticipantsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'evt-1',
    name: 'The Open',
    venue: 'Royal Liverpool',
    location: 'Hoylake',
    startDate: '2026-07-16T08:00:00.000Z',
    endDate: '2026-07-19T20:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    eventSeriesId: 'event-series-1',
    eventYear: 2026,
    sportLeagueId: 'league-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    loadedParticipantCount: 2,
    tierCount: 6,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierLabels: [], contestCount: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    allowedTransitions: [],
    ...overrides,
  });
}

// #236: a field row is the shared SportEventParticipant embedding its participant.
function fieldEntry({
  id = 'sep-rory',
  participantId = 'p-rory',
  name = 'Rory McIlroy',
  ranking = 2,
  affiliatedWithSportLeague = true,
  valuation = valuationFixture({ sportEventTierId: 'tier-1', tierAssignedSource: 'AUTO_ODDS', price: 9500, priceAssignedSource: 'AUTO_ODDS' }),
}: {
  id?: string;
  participantId?: string;
  name?: string;
  ranking?: number;
  affiliatedWithSportLeague?: boolean;
  valuation?: ReturnType<typeof valuationFixture> | null;
} = {}) {
  return fieldEntryFixture({
    id,
    participantId,
    participant: participantFixture({ id: participantId, name }),
    ranking,
    oddsToWin: 8.5,
    seedNumber: 2,
    valuation,
    affiliatedWithSportLeague,
  });
}

const TIERS = [tierFixture({ tierNumber: 1 }), tierFixture({ tierNumber: 2 })];

function seed(overrides: { tournament?: Parameters<typeof tournament>[0]; entries?: unknown[] } = {}) {
  listEventTiersMock.mockResolvedValue({ data: { tiers: TIERS } });
  getEventMock.mockResolvedValue({
    data: { event: tournament(overrides.tournament) },
  });
  listEventParticipantsMock.mockResolvedValue({
    data: {
      participants: overrides.entries ?? [
        fieldEntry(),
        fieldEntry({
          id: 'sep-guest',
          participantId: 'p-guest',
          name: 'Sponsor Exemption',
          affiliatedWithSportLeague: false,
          ranking: 400,
        }),
      ],
    },
  });
}

function renderPage({ tab = 'field', isSynced = false }: { tab?: 'field' | 'tools'; isSynced?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/manage/sports/golf/events/evt-1/${tab}`]}>
        <Routes>
          <Route element={<EventTabOutlet isSynced={isSynced} />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventFieldTab />} path="field" />
            <Route element={<EventToolsTab />} path="tools" />
          </Route>
        </Routes>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-za4 the Event page\'s Field tab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-za4 renders the field grid, flags a guest, and shows seed + add actions', async () => {
    seed();
    renderPage();

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    const guestRow = screen.getByTestId('root-admin-event-field-row-sep-guest');
    expect(within(guestRow).getByText('Guest')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-field-seed')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-field-add')).toBeInTheDocument();
    // NONE sync scope -> no Load/Refresh action.
    expect(screen.queryByTestId('root-admin-event-field-refresh')).not.toBeInTheDocument();
  });

  it('pool-master-za4 shows the Load Participant Field action only for a linked tournament', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
    renderPage();

    const refresh = await screen.findByTestId('root-admin-event-field-refresh');
    expect(refresh).toHaveTextContent('Load Participant Field');
  });

  it('offers no hand correction tools on a synced event (no seed, add or load), only automatic tiers and prices', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY', status: 'DRAFT' } });
    renderPage({ isSynced: true });

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-tier-auto-tiers')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-field-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-field-seed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-field-refresh')).not.toBeInTheDocument();
  });

  it('hides automatic tiers and prices once the event is released, since its tiers and prices are locked', async () => {
    seed({ tournament: { status: 'IN_PROGRESS' } });
    renderPage();

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-tier-auto-tiers')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-tier-auto-prices')).not.toBeInTheDocument();
  });

  it('shows each row\'s tier, price and who set them, and the feed\'s last sighting only on a synced event', async () => {
    seed({
      entries: [
        fieldEntry(),
        fieldEntry({ id: 'sep-guest', participantId: 'p-guest', name: 'Sponsor Exemption', valuation: valuationFixture({ sportEventTierId: 'tier-2', tierAssignedSource: 'MANUAL', price: 500, priceAssignedSource: 'AUTO_ODDS' }) }),
        fieldEntry({ id: 'sep-new', participantId: 'p-new', name: 'Late Entry', valuation: null }),
      ],
    });
    renderPage();

    const rory = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    expect(rory).toHaveTextContent('Tier 1');
    expect(rory).toHaveTextContent('Auto');
    expect(screen.getByTestId('root-admin-event-field-row-sep-guest')).toHaveTextContent('Manual');
    expect(screen.getByTestId('root-admin-event-field-row-sep-new')).not.toHaveTextContent(/Auto|Manual/);
    expect(screen.queryByRole('columnheader', { name: /Last in feed/ })).not.toBeInTheDocument();
  });

  it('warns that hand-set rankings, odds, seeds and withdrawals are replaced before refreshing a loaded field, and refreshes only on confirm', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY' } });
    refreshEventParticipantsMock.mockResolvedValue({ data: { syncRuns: [] } });
    renderPage();

    // The action's words follow the field, so they are read once it has loaded.
    await screen.findByText('Rory McIlroy');
    const refresh = screen.getByTestId('root-admin-event-field-refresh');
    expect(refresh).toHaveTextContent('Refresh Participant Field');
    await userEvent.click(refresh);

    const modal = await screen.findByTestId('root-admin-event-field-refresh-modal');
    expect(modal).toHaveTextContent(
      "rankings, odds, seeds and withdrawals you set in the field grid or by bulk upload are replaced with the provider's values",
    );
    expect(refreshEventParticipantsMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('root-admin-event-field-refresh-confirm'));
    await waitFor(() =>
      expect(refreshEventParticipantsMock).toHaveBeenCalledWith({
        path: { eventId: 'evt-1' },
      }),
    );
  });

  it('opens a participant\'s details and its tier and price from the row\'s ⤢', async () => {
    seed();
    renderPage();

    const row = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));

    const dialog = await screen.findByTestId('root-admin-event-participant-dialog');
    expect(within(dialog).getByTestId('root-admin-event-participant-dialog-rank')).toHaveTextContent('2');
    expect(within(dialog).getByTestId('root-admin-event-participant-dialog-tier')).toHaveTextContent('Tier 1');
    expect(within(dialog).getByTestId('root-admin-event-participant-dialog-price')).toHaveTextContent('9500');
    expect(within(dialog).getByTestId('root-admin-event-participant-dialog-set-by')).toHaveTextContent('Auto');
  });

  it('withdraws a participant behind a confirmation, sending only its withdrawal', async () => {
    seed();
    updateEventParticipantsMock.mockResolvedValue({ data: { participants: [fieldEntry()] } });
    renderPage();

    const row = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));
    await userEvent.click(await screen.findByTestId('root-admin-event-participant-dialog-withdraw'));
    expect(updateEventParticipantsMock).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByTestId('root-admin-event-participant-dialog-withdraw-confirm'));

    await waitFor(() => expect(updateEventParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1' },
      body: { participants: [{ sportEventParticipantId: 'sep-rory', isActive: false, inactiveReason: 'WITHDRAWN' }] },
    })));
  });

  it('moves a participant to another tier, placed last in it, and sends a corrected price as a field patch', async () => {
    seed({
      entries: [
        fieldEntry(),
        fieldEntry({ id: 'sep-two', participantId: 'p-two', name: 'Second Tier', valuation: valuationFixture({ sportEventTierId: 'tier-2' }) }),
      ],
      tournament: { status: 'DRAFT' },
    });
    updateEventParticipantsMock.mockResolvedValue({ data: { participants: [fieldEntry()] } });
    replaceEventTierAssignmentsMock.mockResolvedValue({ data: { tiers: [] } });
    renderPage();

    const row = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));
    await userEvent.click(await screen.findByTestId('root-admin-event-participant-dialog-edit'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-event-participant-dialog-edit-tier'), 'TIER_2');
    const price = screen.getByTestId('root-admin-event-participant-dialog-edit-price');
    await userEvent.clear(price);
    await userEvent.type(price, '8000');
    await userEvent.click(screen.getByTestId('root-admin-event-participant-dialog-save'));

    await waitFor(() => expect(replaceEventTierAssignmentsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1' },
      body: { assignments: [{ sportEventParticipantId: 'sep-rory', tierKey: 'TIER_2', tierOrderIndex: 1 }] },
    })));
    expect(updateEventParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { participants: [{ sportEventParticipantId: 'sep-rory', price: 8000 }] },
    }));
  });

  it('keeps Save off while a typed odds value is not a number', async () => {
    seed();
    renderPage();

    const row = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));
    await userEvent.click(await screen.findByTestId('root-admin-event-participant-dialog-edit'));
    const odds = screen.getByTestId('root-admin-event-participant-dialog-edit-odds');
    await userEvent.clear(odds);
    await userEvent.type(odds, 'abc');

    expect(await screen.findByText('Odds are a number above 0, or blank')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-participant-dialog-save')).toBeDisabled();
  });

  it('corrects only tier and price on a synced event, whose feed sets rank, odds and seed', async () => {
    seed({ tournament: { status: 'DRAFT' } });
    renderPage({ isSynced: true });

    const row = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));
    await userEvent.click(await screen.findByTestId('root-admin-event-participant-dialog-edit'));

    expect(screen.getByTestId('root-admin-event-participant-dialog-edit-tier')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-participant-dialog-edit-odds')).not.toBeInTheDocument();
  });

  it('offers no Edit on a released synced event, where nothing the dialog corrects is open, but still offers Withdraw', async () => {
    seed({ tournament: { status: 'IN_PROGRESS' } });
    renderPage({ isSynced: true });

    const row = await screen.findByTestId('root-admin-event-field-row-sep-rory');
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));

    expect(await screen.findByTestId('root-admin-event-participant-dialog-withdraw')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-participant-dialog-edit')).not.toBeInTheDocument();
  });

  it('shows the field\'s bulk upload on the Tools tab, open and without a Close', async () => {
    seed();
    renderPage({ tab: 'tools' });

    expect(await screen.findByTestId('root-admin-event-field-upload-card')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-field-upload-textarea')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-field-upload-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-field-upload-open')).not.toBeInTheDocument();
  });

  it('pool-master-za4 seeds the field from the league roster behind a confirmation', async () => {
    seed();
    seedEventParticipantsMock.mockResolvedValue({
      data: { added: 140, skipped: 2, total: 142, seedNumbersDerived: 140, oddsDerived: 140 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-event-field-seed'));
    await userEvent.click(screen.getByTestId('root-admin-event-field-seed-confirm'));

    await waitFor(() =>
      expect(seedEventParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { eventId: 'evt-1' } }),
      ),
    );
    expect(
      await screen.findByTestId('root-admin-event-field-seed-result'),
    ).toHaveTextContent('Added 140');
  });

  it('pool-master-za4 adds participants from the event\'s own league roster', async () => {
    seed();
    listSportLeagueParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          participantFixture({ id: 'p-rory', name: 'Rory McIlroy', ranking: 2 }),
          participantFixture({ id: 'p-jon', name: 'Jon Rahm', ranking: 3 }),
        ],
      },
    });
    addEventParticipantsMock.mockResolvedValue({
      data: { added: 1, skipped: 0, total: 1 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-event-field-add'));

    // Rory is already in the field -> not offered.
    expect(await screen.findByTestId('root-admin-event-field-add-candidate-p-jon')).toHaveTextContent('Ranking 3');
    expect(
      screen.queryByTestId('root-admin-event-field-add-candidate-p-rory'),
    ).not.toBeInTheDocument();
    expect(listSportLeagueParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'league-1' } }));

    await userEvent.click(screen.getByTestId('root-admin-event-field-add-candidate-p-jon'));
    await userEvent.click(screen.getByTestId('root-admin-event-field-add-modal-apply'));

    await waitFor(() =>
      expect(addEventParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: { participantIds: ['p-jon'] },
        }),
      ),
    );
    // A save closes the picker and says what was added.
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Added 1 golfer to the field');
    expect(screen.queryByTestId('root-admin-event-field-add-modal')).not.toBeInTheDocument();
  });
});

describe('Field editor header actions: refusals, singular counts and closing dialogs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  function refusal(code: string, message: string, status = 422) {
    return { error: { error: { code, message } }, response: { status } };
  }

  describe('seed from league roster', () => {
    it('uses singular wording when exactly one golfer is added and one seed number derived', async () => {
      seed();
      seedEventParticipantsMock.mockResolvedValue({
        data: { added: 1, skipped: 0, total: 1, seedNumbersDerived: 1, oddsDerived: 1 },
      });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-seed'));
      await userEvent.click(screen.getByTestId('root-admin-event-field-seed-confirm'));

      expect(await screen.findByTestId('root-admin-event-field-seed-result')).toHaveTextContent(
        'Added 1 golfer (0 already in the field). Derived 1 seed number and 1 odds.',
      );
    });

    it('shows the server\'s reason in the confirmation when seeding is refused, and adds no result', async () => {
      seed();
      seedEventParticipantsMock.mockResolvedValue(
        refusal('SPORT_LEAGUE_ROSTER_EMPTY', 'The PGA Tour roster has no golfers to seed.'),
      );
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-seed'));
      await userEvent.click(screen.getByTestId('root-admin-event-field-seed-confirm'));

      const modal = await screen.findByTestId('root-admin-event-field-seed-modal');
      expect(await within(modal).findByText('The PGA Tour roster has no golfers to seed.')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-event-field-seed-result')).not.toBeInTheDocument();
    });

    it('closes the seed confirmation from its close button without seeding', async () => {
      seed();
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-seed'));
      const modal = await screen.findByTestId('root-admin-event-field-seed-modal');
      await userEvent.click(within(modal).getByRole('button', { name: /^Close / }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-event-field-seed-modal')).not.toBeInTheDocument(),
      );
      expect(seedEventParticipantsMock).not.toHaveBeenCalled();
    });
  });

  describe('load or refresh the participant field', () => {
    it('loads an empty linked field at once, without a confirmation, and says the sync started', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
      refreshEventParticipantsMock.mockResolvedValue({ data: { syncRuns: [] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-refresh'));

      await waitFor(() =>
        expect(refreshEventParticipantsMock).toHaveBeenCalledWith({ path: { eventId: 'evt-1' } }),
      );
      expect(screen.queryByTestId('root-admin-event-field-refresh-modal')).not.toBeInTheDocument();
      expect(await screen.findByTestId('root-admin-event-field-refresh-result')).toHaveTextContent(
        'Provider field sync started.',
      );
    });

    it('shows the server\'s reason under the button when loading an empty field is refused', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
      refreshEventParticipantsMock.mockResolvedValue(
        refusal('PROVIDER_EVENT_NOT_FOUND', 'Provider mock-contest-feed has no event mock-weekend.', 404),
      );
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-refresh'));

      expect(await screen.findByTestId('root-admin-event-field-refresh-error')).toHaveTextContent(
        'Provider mock-contest-feed has no event mock-weekend.',
      );
      expect(screen.queryByTestId('root-admin-event-field-refresh-result')).not.toBeInTheDocument();
    });

    it('shows the server\'s reason inside the confirmation when refreshing a loaded field is refused', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' } });
      refreshEventParticipantsMock.mockResolvedValue(
        refusal('SYNC_ALREADY_RUNNING', 'A field sync is already running for this tournament.', 409),
      );
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-refresh'));
      await userEvent.click(await screen.findByTestId('root-admin-event-field-refresh-confirm'));

      const modal = screen.getByTestId('root-admin-event-field-refresh-modal');
      expect(
        await within(modal).findByText('A field sync is already running for this tournament.'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-event-field-refresh-error')).not.toBeInTheDocument();
    });

    it('closes the refresh confirmation from its close button without refreshing', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-event-field-refresh'));
      const modal = await screen.findByTestId('root-admin-event-field-refresh-modal');
      await userEvent.click(within(modal).getByRole('button', { name: /^Close / }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-event-field-refresh-modal')).not.toBeInTheDocument(),
      );
      expect(refreshEventParticipantsMock).not.toHaveBeenCalled();
    });
  });

  describe('add more participants', () => {
    function rosterOf(...golfers: Array<{ id: string; name: string; status?: 'ACTIVE' | 'INACTIVE' }>) {
      return {
        data: {
          participants: golfers.map((golfer, index) =>
            participantFixture({ id: golfer.id, name: golfer.name, ranking: index + 1, status: golfer.status ?? 'ACTIVE' }),
          ),
        },
      };
    }

    async function openAddModal() {
      await userEvent.click(await screen.findByTestId('root-admin-event-field-add'));
      return screen.findByTestId('root-admin-event-field-add-modal');
    }

    it('selects every offered golfer with select-all, clears them again, and reports a plural add with skips', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(
        rosterOf({ id: 'p-jon', name: 'Jon Rahm' }, { id: 'p-cam', name: 'Cameron Smith' }),
      );
      addEventParticipantsMock.mockResolvedValue({ data: { added: 2, skipped: 1, total: 3 } });
      renderPage();

      await openAddModal();
      await screen.findByTestId('root-admin-event-field-add-candidate-p-jon');

      await userEvent.click(screen.getByTestId('root-admin-event-field-add-roster-select-all'));
      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toHaveTextContent('Add selected (2)');
      await userEvent.click(screen.getByTestId('root-admin-event-field-add-roster-select-all'));
      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toHaveTextContent('Add selected (0)');
      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toBeDisabled();

      await userEvent.click(screen.getByTestId('root-admin-event-field-add-roster-select-all'));
      await userEvent.click(screen.getByTestId('root-admin-event-field-add-modal-apply'));

      await waitFor(() => expect(addEventParticipantsMock).toHaveBeenCalledTimes(1));
      expect(
        (addEventParticipantsMock.mock.calls[0][0] as { body: { participantIds: string[] } }).body.participantIds,
      ).toEqual(['p-jon', 'p-cam']);
      const toast = await screen.findByTestId('app-toast');
      expect(toast).toHaveTextContent('Added 2 golfers to the field');
      expect(toast).toHaveTextContent('1 were already in it.');
      expect(screen.queryByTestId('root-admin-event-field-add-modal')).not.toBeInTheDocument();
    });

    it('unticks a golfer that was ticked, so it is not added', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(rosterOf({ id: 'p-jon', name: 'Jon Rahm' }));
      renderPage();

      await openAddModal();
      const select = await screen.findByTestId('root-admin-event-field-add-candidate-p-jon');
      await userEvent.click(select);
      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toHaveTextContent('Add selected (1)');
      await userEvent.click(select);

      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toHaveTextContent('Add selected (0)');
      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toBeDisabled();
    });

    it('offers no inactive golfer, and says every active golfer is already in the field when the roster adds no one new', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(rosterOf({ id: 'p-rory', name: 'Rory McIlroy' }, { id: 'p-old', name: 'Old Timer', status: 'INACTIVE' }));
      renderPage();

      await openAddModal();

      expect(await screen.findByText('Every active golfer in this tour is already in the field.')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-event-field-add-candidate-p-old')).not.toBeInTheDocument();
    });

    it('shows the server\'s reason when the league roster cannot be loaded', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(
        refusal('SPORT_LEAGUE_NOT_FOUND', 'Sport league league-1 was not found.', 404),
      );
      renderPage();

      await openAddModal();

      expect(await screen.findByText('Sport league league-1 was not found.')).toBeInTheDocument();
    });

    it('narrows the roster to the typed name, and says no new golfers matched when none does', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(
        rosterOf({ id: 'p-jon', name: 'Jon Rahm' }, { id: 'p-cam', name: 'Cameron Smith' }),
      );
      renderPage();

      await openAddModal();
      await screen.findByTestId('root-admin-event-field-add-candidate-p-jon');
      fireEvent.change(screen.getByTestId('root-admin-event-field-add-search'), { target: { value: 'cam' } });

      expect(await screen.findByTestId('root-admin-event-field-add-candidate-p-cam')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-event-field-add-candidate-p-jon')).not.toBeInTheDocument();
      expect(screen.getByTestId('root-admin-event-field-add-roster-select-all')).toHaveTextContent('Select all 1');

      fireEvent.change(screen.getByTestId('root-admin-event-field-add-search'), { target: { value: 'Nobody' } });
      expect(await screen.findByText('No new golfers matched that search.')).toBeInTheDocument();
    });

    it('shows the server\'s reason and keeps the selection when adding golfers is refused', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(rosterOf({ id: 'p-jon', name: 'Jon Rahm' }));
      addEventParticipantsMock.mockResolvedValue(
        refusal('SPORT_EVENT_FIELD_LOCKED', 'The field is locked for this tournament.', 409),
      );
      renderPage();

      await openAddModal();
      await userEvent.click(await screen.findByTestId('root-admin-event-field-add-candidate-p-jon'));
      await userEvent.click(screen.getByTestId('root-admin-event-field-add-modal-apply'));

      expect(await screen.findByText('The field is locked for this tournament.')).toBeInTheDocument();
      expect(screen.getByTestId('root-admin-event-field-add-modal-apply')).toHaveTextContent('Add selected (1)');
      expect(screen.queryByTestId('app-toast')).not.toBeInTheDocument();
    });

    it('closes the add dialog from its close button without adding anyone', async () => {
      seed();
      listSportLeagueParticipantsMock.mockResolvedValue(rosterOf());
      renderPage();

      const modal = await openAddModal();
      await userEvent.click(within(modal).getByRole('button', { name: /^Close / }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-event-field-add-modal')).not.toBeInTheDocument(),
      );
      expect(addEventParticipantsMock).not.toHaveBeenCalled();
    });
  });
});
