import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentFieldPage } from './root-admin-golf-tournament-field-page';
import {
  affiliationFixture,
  fieldEntryFixture,
  participantFixture,
  GOLF_SPORT_FIXTURE,
  sportEventFixture,
  sportLeagueFixture,
  valuationFixture,
} from './golf-test-fixtures';

// plans/124 §6.3 — /manage/golf/tournaments/:eventId/field Field editor (pool-master-za4).

const {
  getEventMock,
  listEventParticipantsMock,
  updateEventParticipantsMock,
  seedEventParticipantsMock,
  refreshEventParticipantsMock,
  addEventParticipantsMock,
  listSportLeaguesMock,
  listParticipantLeagueAffiliationsMock,
  listParticipantsMock,
  listSportsMock,
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
    updateEventParticipantsMock: vi.fn(),
    seedEventParticipantsMock: vi.fn(),
    refreshEventParticipantsMock: vi.fn(),
    addEventParticipantsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listParticipantLeagueAffiliationsMock: vi.fn(),
    listParticipantsMock: vi.fn(),
    listSportsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventParticipants: listEventParticipantsMock,
  updateEventParticipants: updateEventParticipantsMock,
  seedEventParticipants: seedEventParticipantsMock,
  refreshEventParticipants: refreshEventParticipantsMock,
  addEventParticipants: addEventParticipantsMock,
  listSportLeagues: listSportLeaguesMock,
  listParticipantLeagueAffiliations: listParticipantLeagueAffiliationsMock,
  listParticipants: listParticipantsMock,
  listSports: listSportsMock,
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
    contestCount: 0,
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
}: {
  id?: string;
  participantId?: string;
  name?: string;
  ranking?: number;
  affiliatedWithSportLeague?: boolean;
} = {}) {
  return fieldEntryFixture({
    id,
    participantId,
    participant: participantFixture({ id: participantId, name }),
    ranking,
    oddsToWin: 8.5,
    seedNumber: 2,
    valuation: valuationFixture({ price: 9500 }),
    affiliatedWithSportLeague,
  });
}

function seed(overrides: { tournament?: Parameters<typeof tournament>[0]; entries?: unknown[] } = {}) {
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/golf/tournaments/evt-1/field']}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentFieldPage />}
            path="/manage/golf/tournaments/:eventId/field"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-za4 RootAdminGolfTournamentFieldPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-za4 renders the field grid, flags a guest, and shows seed + add actions', async () => {
    seed();
    renderPage();

    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    const guestRow = screen.getByTestId('root-admin-golf-field-row-sep-guest');
    expect(within(guestRow).getByText('Guest')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-field-seed')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-field-add')).toBeInTheDocument();
    // NONE sync scope -> no Load/Refresh action.
    expect(screen.queryByTestId('root-admin-golf-field-refresh')).not.toBeInTheDocument();
  });

  it('shows the shared tournament header with Field marked in its sub-menu, in place of a back link', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-tournament-identity')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tournament-menu-field')).toBeChecked();
    expect(screen.queryByTestId('root-admin-golf-field-back')).not.toBeInTheDocument();
  });

  it('pool-master-za4 shows the Load Participant Field action only for a linked tournament', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
    renderPage();

    const refresh = await screen.findByTestId('root-admin-golf-field-refresh');
    expect(refresh).toHaveTextContent('Load Participant Field');
  });

  it('warns that hand-set rankings, odds, seeds and withdrawals are replaced before refreshing a loaded field, and refreshes only on confirm', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY' } });
    refreshEventParticipantsMock.mockResolvedValue({ data: { syncRuns: [] } });
    renderPage();

    const refresh = await screen.findByTestId('root-admin-golf-field-refresh');
    expect(refresh).toHaveTextContent('Refresh Participant Field');
    await userEvent.click(refresh);

    const modal = await screen.findByTestId('root-admin-golf-field-refresh-modal');
    expect(modal).toHaveTextContent(
      "rankings, odds, seeds and withdrawals you set in the field grid or by bulk upload are replaced with the provider's values",
    );
    expect(refreshEventParticipantsMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('root-admin-golf-field-refresh-confirm'));
    await waitFor(() =>
      expect(refreshEventParticipantsMock).toHaveBeenCalledWith({
        path: { eventId: 'evt-1' },
      }),
    );
  });

  it('pool-master-za4 surfaces the tournament load error', async () => {
    getEventMock.mockResolvedValue({
      error: { error: { code: 'NOT_FOUND', message: 'No such tournament' } },
      response: { status: 404 },
    });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();

    expect(await screen.findByText('No such tournament')).toBeInTheDocument();
  });

  it('pool-master-za4 collects a ranking edit and an activate toggle into one save call', async () => {
    seed();
    updateEventParticipantsMock.mockResolvedValue({
      data: { participants: [fieldEntry({ ranking: 1 })] },
    });
    renderPage();

    const rankInput = await screen.findByTestId('root-admin-golf-field-ranking-sep-rory');
    await userEvent.clear(rankInput);
    await userEvent.type(rankInput, '1');

    await userEvent.click(screen.getByTestId('root-admin-golf-field-active-sep-guest'));
    // Reason select appears once a golfer is toggled inactive.
    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-field-reason-sep-guest'),
      'ELIMINATED',
    );

    expect(
      await screen.findByTestId('root-admin-golf-field-dirty-bar'),
    ).toHaveTextContent('2 unsaved rows');

    await userEvent.click(screen.getByTestId('root-admin-golf-field-save'));

    await waitFor(() =>
      expect(updateEventParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
            participants: expect.arrayContaining([
              { sportEventParticipantId: 'sep-rory', ranking: 1 },
              {
                sportEventParticipantId: 'sep-guest',
                isActive: false,
                inactiveReason: 'ELIMINATED',
              },
            ]),
          },
        }),
      ),
    );
  });

  it('pool-master-za4 blocks save on an invalid numeric value', async () => {
    seed();
    renderPage();

    const oddsInput = await screen.findByTestId('root-admin-golf-field-oddsToWin-sep-rory');
    await userEvent.clear(oddsInput);
    await userEvent.type(oddsInput, 'abc');

    expect(
      await screen.findByTestId('root-admin-golf-field-dirty-bar'),
    ).toHaveTextContent('invalid');
    expect(screen.getByTestId('root-admin-golf-field-save')).toBeDisabled();
  });

  it('opens the bulk upload card from the Bulk upload action, above the field grid, and closes it again', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-field-upload-open'));

    expect(screen.getByTestId('root-admin-golf-field-upload-card')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-field-upload-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-field-upload-open')).toBeDisabled();

    await userEvent.click(screen.getByTestId('root-admin-golf-field-upload-close'));
    expect(screen.queryByTestId('root-admin-golf-field-upload-card')).not.toBeInTheDocument();
  });

  it('pool-master-za4 seeds the field from the league roster behind a confirmation', async () => {
    seed();
    seedEventParticipantsMock.mockResolvedValue({
      data: { added: 140, skipped: 2, total: 142, seedNumbersDerived: 140, oddsDerived: 140 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-field-seed'));
    await userEvent.click(screen.getByTestId('root-admin-golf-field-seed-confirm'));

    await waitFor(() =>
      expect(seedEventParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { eventId: 'evt-1' } }),
      ),
    );
    expect(
      await screen.findByTestId('root-admin-golf-field-seed-result'),
    ).toHaveTextContent('Added 140');
  });

  it('pool-master-za4 adds participants from a browsed league roster', async () => {
    seed();
    listSportLeaguesMock.mockResolvedValue({
      data: { sportLeagues: [sportLeagueFixture({ id: 'liv', name: 'LIV Golf', matchKeyword: 'LIV' })] },
    });
    listParticipantLeagueAffiliationsMock.mockResolvedValue({
      data: {
        affiliations: [
          affiliationFixture({
            sportLeagueId: 'liv',
            participantId: 'p-jon',
            ranking: 3,
            participant: participantFixture({ id: 'p-jon', name: 'Jon Rahm' }),
          }),
          affiliationFixture({
            sportLeagueId: 'liv',
            participantId: 'p-rory',
            ranking: 2,
            participant: participantFixture({ id: 'p-rory', name: 'Rory McIlroy' }),
          }),
        ],
      },
    });
    addEventParticipantsMock.mockResolvedValue({
      data: { added: 1, skipped: 0, total: 1 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-field-add'));
    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-field-add-league'),
      'liv',
    );

    // Rory is already in the field -> excluded from the browse grid.
    expect(await screen.findByTestId('root-admin-golf-field-add-roster-row-p-jon')).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-golf-field-add-roster-row-p-rory'),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('root-admin-golf-field-add-roster-select-p-jon'));
    await userEvent.click(screen.getByTestId('root-admin-golf-field-add-submit'));

    await waitFor(() =>
      expect(addEventParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: { participantIds: ['p-jon'] },
        }),
      ),
    );
    // The modal reports the {added, skipped} result rather than closing silently.
    expect(
      await screen.findByTestId('root-admin-golf-field-add-result'),
    ).toHaveTextContent('Added 1 golfer');
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

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-seed'));
      await userEvent.click(screen.getByTestId('root-admin-golf-field-seed-confirm'));

      expect(await screen.findByTestId('root-admin-golf-field-seed-result')).toHaveTextContent(
        'Added 1 golfer (0 already in the field). Derived 1 seed number and 1 odds.',
      );
    });

    it('shows the server\'s reason in the confirmation when seeding is refused, and adds no result', async () => {
      seed();
      seedEventParticipantsMock.mockResolvedValue(
        refusal('SPORT_LEAGUE_ROSTER_EMPTY', 'The PGA Tour roster has no golfers to seed.'),
      );
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-seed'));
      await userEvent.click(screen.getByTestId('root-admin-golf-field-seed-confirm'));

      const modal = await screen.findByTestId('root-admin-golf-field-seed-modal');
      expect(await within(modal).findByText('The PGA Tour roster has no golfers to seed.')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-golf-field-seed-result')).not.toBeInTheDocument();
    });

    it('closes the seed confirmation from its close button without seeding', async () => {
      seed();
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-seed'));
      const modal = await screen.findByTestId('root-admin-golf-field-seed-modal');
      await userEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-golf-field-seed-modal')).not.toBeInTheDocument(),
      );
      expect(seedEventParticipantsMock).not.toHaveBeenCalled();
    });
  });

  describe('load or refresh the participant field', () => {
    it('loads an empty linked field at once, without a confirmation, and says the sync started', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
      refreshEventParticipantsMock.mockResolvedValue({ data: { syncRuns: [] } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-refresh'));

      await waitFor(() =>
        expect(refreshEventParticipantsMock).toHaveBeenCalledWith({ path: { eventId: 'evt-1' } }),
      );
      expect(screen.queryByTestId('root-admin-golf-field-refresh-modal')).not.toBeInTheDocument();
      expect(await screen.findByTestId('root-admin-golf-field-refresh-result')).toHaveTextContent(
        'Provider field sync started.',
      );
    });

    it('shows the server\'s reason under the button when loading an empty field is refused', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
      refreshEventParticipantsMock.mockResolvedValue(
        refusal('PROVIDER_EVENT_NOT_FOUND', 'Provider mock-contest-feed has no event mock-weekend.', 404),
      );
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-refresh'));

      expect(await screen.findByTestId('root-admin-golf-field-refresh-error')).toHaveTextContent(
        'Provider mock-contest-feed has no event mock-weekend.',
      );
      expect(screen.queryByTestId('root-admin-golf-field-refresh-result')).not.toBeInTheDocument();
    });

    it('shows the server\'s reason inside the confirmation when refreshing a loaded field is refused', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' } });
      refreshEventParticipantsMock.mockResolvedValue(
        refusal('SYNC_ALREADY_RUNNING', 'A field sync is already running for this tournament.', 409),
      );
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-refresh'));
      await userEvent.click(await screen.findByTestId('root-admin-golf-field-refresh-confirm'));

      const modal = screen.getByTestId('root-admin-golf-field-refresh-modal');
      expect(
        await within(modal).findByText('A field sync is already running for this tournament.'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-golf-field-refresh-error')).not.toBeInTheDocument();
    });

    it('closes the refresh confirmation from its close button without refreshing', async () => {
      seed({ tournament: { syncScope: 'SCORES_ONLY' } });
      renderPage();

      await userEvent.click(await screen.findByTestId('root-admin-golf-field-refresh'));
      const modal = await screen.findByTestId('root-admin-golf-field-refresh-modal');
      await userEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-golf-field-refresh-modal')).not.toBeInTheDocument(),
      );
      expect(refreshEventParticipantsMock).not.toHaveBeenCalled();
    });
  });

  describe('add more participants', () => {
    function rosterOf(...golfers: Array<{ id: string; name: string }>) {
      return {
        data: {
          affiliations: golfers.map((golfer, index) =>
            affiliationFixture({
              sportLeagueId: 'liv',
              participantId: golfer.id,
              ranking: index + 1,
              participant: participantFixture({ id: golfer.id, name: golfer.name }),
            }),
          ),
        },
      };
    }

    async function openAddModal() {
      await userEvent.click(await screen.findByTestId('root-admin-golf-field-add'));
      return screen.findByTestId('root-admin-golf-field-add-modal');
    }

    function seedLeagues() {
      listSportLeaguesMock.mockResolvedValue({
        data: { sportLeagues: [sportLeagueFixture({ id: 'liv', name: 'LIV Golf', matchKeyword: 'LIV' })] },
      });
      listSportsMock.mockResolvedValue({ data: { sports: [GOLF_SPORT_FIXTURE] } });
    }

    it('selects every browsed golfer with select-all, clears them again, and reports a plural add with skips', async () => {
      seed();
      seedLeagues();
      listParticipantLeagueAffiliationsMock.mockResolvedValue(
        rosterOf({ id: 'p-jon', name: 'Jon Rahm' }, { id: 'p-cam', name: 'Cameron Smith' }),
      );
      addEventParticipantsMock.mockResolvedValue({ data: { added: 2, skipped: 1, total: 3 } });
      renderPage();

      await openAddModal();
      await userEvent.selectOptions(await screen.findByTestId('root-admin-golf-field-add-league'), 'liv');
      await screen.findByTestId('root-admin-golf-field-add-roster-row-p-jon');

      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-roster-select-all'));
      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toHaveTextContent('Add selected (2)');
      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-roster-select-all'));
      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toHaveTextContent('Add selected (0)');
      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toBeDisabled();

      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-roster-select-all'));
      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-submit'));

      await waitFor(() => expect(addEventParticipantsMock).toHaveBeenCalledTimes(1));
      expect(
        (addEventParticipantsMock.mock.calls[0][0] as { body: { participantIds: string[] } }).body.participantIds,
      ).toEqual(['p-jon', 'p-cam']);
      expect(await screen.findByTestId('root-admin-golf-field-add-result')).toHaveTextContent(
        'Added 2 golfers to the field (1 were already in it).',
      );
      expect(screen.getByTestId('root-admin-golf-field-add-league')).toBeDisabled();
    });

    it('unticks a golfer that was ticked, so it is not added', async () => {
      seed();
      seedLeagues();
      listParticipantLeagueAffiliationsMock.mockResolvedValue(rosterOf({ id: 'p-jon', name: 'Jon Rahm' }));
      renderPage();

      await openAddModal();
      await userEvent.selectOptions(await screen.findByTestId('root-admin-golf-field-add-league'), 'liv');
      const select = await screen.findByTestId('root-admin-golf-field-add-roster-select-p-jon');
      await userEvent.click(select);
      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toHaveTextContent('Add selected (1)');
      await userEvent.click(select);

      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toHaveTextContent('Add selected (0)');
      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toBeDisabled();
    });

    it('says every roster golfer is already in the field when the browsed roster adds no one new', async () => {
      seed();
      seedLeagues();
      listParticipantLeagueAffiliationsMock.mockResolvedValue(rosterOf({ id: 'p-rory', name: 'Rory McIlroy' }));
      renderPage();

      await openAddModal();
      await userEvent.selectOptions(await screen.findByTestId('root-admin-golf-field-add-league'), 'liv');

      expect(
        await screen.findByText('Every golfer on that league’s roster is already in this field.'),
      ).toBeInTheDocument();
    });

    it('shows the server\'s reason when the browsed league roster cannot be loaded', async () => {
      seed();
      seedLeagues();
      listParticipantLeagueAffiliationsMock.mockResolvedValue(
        refusal('SPORT_LEAGUE_NOT_FOUND', 'Sport league liv was not found.', 404),
      );
      renderPage();

      await openAddModal();
      await userEvent.selectOptions(await screen.findByTestId('root-admin-golf-field-add-league'), 'liv');

      expect(await screen.findByText('Roster unavailable')).toBeInTheDocument();
      expect(screen.getByText('Sport league liv was not found.')).toBeInTheDocument();
    });

    it('falls back to the name search when the league list cannot be loaded', async () => {
      seed();
      listSportLeaguesMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The league store is unavailable.', 500));
      renderPage();

      await openAddModal();

      expect(await screen.findByText('Leagues unavailable')).toBeInTheDocument();
      expect(screen.queryByTestId('root-admin-golf-field-add-league')).not.toBeInTheDocument();
      expect(screen.getByTestId('root-admin-golf-field-add-search')).toBeInTheDocument();
    });

    it('lists searched golfers who are not in the field, adds a ticked one, and hides golfers already in it', async () => {
      seed();
      seedLeagues();
      listParticipantsMock.mockResolvedValue({
        data: {
          participants: [
            participantFixture({ id: 'p-rory', name: 'Rory McIlroy' }),
            participantFixture({ id: 'p-off', name: 'Rory Sabbatini', nationality: 'SVK' }),
          ],
        },
      });
      addEventParticipantsMock.mockResolvedValue({ data: { added: 1, skipped: 0, total: 1 } });
      renderPage();

      await openAddModal();
      fireEvent.change(screen.getByTestId('root-admin-golf-field-add-search'), { target: { value: 'Rory' } });

      const results = await screen.findByTestId('root-admin-golf-field-add-search-results');
      expect(within(results).getByText('Rory Sabbatini')).toBeInTheDocument();
      expect(within(results).queryByText('Rory McIlroy')).not.toBeInTheDocument();
      expect(listParticipantsMock).toHaveBeenCalledWith(
        expect.objectContaining({ query: { sportId: 'sport-golf', status: 'ACTIVE', q: 'Rory' } }),
      );

      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-search-select-p-off'));
      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-submit'));

      await waitFor(() =>
        expect(addEventParticipantsMock).toHaveBeenCalledWith(
          expect.objectContaining({ body: { participantIds: ['p-off'] } }),
        ),
      );
      expect(await screen.findByTestId('root-admin-golf-field-add-result')).toHaveTextContent(
        'Added 1 golfer to the field.',
      );
    });

    it('says no new golfers matched when the search finds only golfers already in the field', async () => {
      seed();
      seedLeagues();
      listParticipantsMock.mockResolvedValue({
        data: { participants: [participantFixture({ id: 'p-rory', name: 'Rory McIlroy' })] },
      });
      renderPage();

      await openAddModal();
      fireEvent.change(screen.getByTestId('root-admin-golf-field-add-search'), { target: { value: 'Rory' } });

      expect(await screen.findByText('No new golfers matched that search.')).toBeInTheDocument();
    });

    it('shows the server\'s reason when the golfer search fails', async () => {
      seed();
      seedLeagues();
      listParticipantsMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'Participant search is unavailable.', 500));
      renderPage();

      await openAddModal();
      fireEvent.change(screen.getByTestId('root-admin-golf-field-add-search'), { target: { value: 'Ro' } });

      expect(await screen.findByText('Search failed')).toBeInTheDocument();
      expect(screen.getByText('Participant search is unavailable.')).toBeInTheDocument();
    });

    it('shows the server\'s reason and keeps the selection when adding golfers is refused', async () => {
      seed();
      seedLeagues();
      listParticipantLeagueAffiliationsMock.mockResolvedValue(rosterOf({ id: 'p-jon', name: 'Jon Rahm' }));
      addEventParticipantsMock.mockResolvedValue(
        refusal('SPORT_EVENT_FIELD_LOCKED', 'The field is locked for this tournament.', 409),
      );
      renderPage();

      await openAddModal();
      await userEvent.selectOptions(await screen.findByTestId('root-admin-golf-field-add-league'), 'liv');
      await userEvent.click(await screen.findByTestId('root-admin-golf-field-add-roster-select-p-jon'));
      await userEvent.click(screen.getByTestId('root-admin-golf-field-add-submit'));

      expect(await screen.findByText('Add failed')).toBeInTheDocument();
      expect(screen.getByText('The field is locked for this tournament.')).toBeInTheDocument();
      expect(screen.getByTestId('root-admin-golf-field-add-submit')).toHaveTextContent('Add selected (1)');
      expect(screen.queryByTestId('root-admin-golf-field-add-result')).not.toBeInTheDocument();
    });

    it('closes the add dialog from its close button without adding anyone', async () => {
      seed();
      seedLeagues();
      renderPage();

      const modal = await openAddModal();
      await userEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

      await waitFor(() =>
        expect(screen.queryByTestId('root-admin-golf-field-add-modal')).not.toBeInTheDocument(),
      );
      expect(addEventParticipantsMock).not.toHaveBeenCalled();
    });
  });
});
