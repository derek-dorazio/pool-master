import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentFieldPage } from './root-admin-golf-tournament-field-page';
import {
  affiliationFixture,
  fieldEntryFixture,
  participantFixture,
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

  it('pool-master-za4 shows the Load Participant Field action only for a linked tournament', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY' }, entries: [] });
    renderPage();

    const refresh = await screen.findByTestId('root-admin-golf-field-refresh');
    expect(refresh).toHaveTextContent('Load Participant Field');
  });

  it('pool-master-za4 surfaces the tournament load error', async () => {
    getEventMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such tournament' },
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
