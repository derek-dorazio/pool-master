import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentFieldPage } from './root-admin-golf-tournament-field-page';

// plans/124 §6.3 — /manage/golf/tournaments/:eventId/field Field editor (pool-master-za4).

const {
  adminGetGolfTournamentMock,
  adminGetGolfTournamentFieldMock,
  adminUpdateGolfFieldEntriesMock,
  adminSeedGolfTournamentFieldMock,
  adminRefreshGolfTournamentFieldMock,
  adminBulkAddGolfFieldEntriesMock,
  adminListGolfLeaguesMock,
  adminGetGolfLeagueRosterMock,
  adminListGolfPlayersMock,
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
    adminGetGolfTournamentMock: vi.fn(),
    adminGetGolfTournamentFieldMock: vi.fn(),
    adminUpdateGolfFieldEntriesMock: vi.fn(),
    adminSeedGolfTournamentFieldMock: vi.fn(),
    adminRefreshGolfTournamentFieldMock: vi.fn(),
    adminBulkAddGolfFieldEntriesMock: vi.fn(),
    adminListGolfLeaguesMock: vi.fn(),
    adminGetGolfLeagueRosterMock: vi.fn(),
    adminListGolfPlayersMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminGetGolfTournament: adminGetGolfTournamentMock,
  adminGetGolfTournamentField: adminGetGolfTournamentFieldMock,
  adminUpdateGolfFieldEntries: adminUpdateGolfFieldEntriesMock,
  adminSeedGolfTournamentField: adminSeedGolfTournamentFieldMock,
  adminRefreshGolfTournamentField: adminRefreshGolfTournamentFieldMock,
  adminBulkAddGolfFieldEntries: adminBulkAddGolfFieldEntriesMock,
  adminListGolfLeagues: adminListGolfLeaguesMock,
  adminGetGolfLeagueRoster: adminGetGolfLeagueRosterMock,
  adminListGolfPlayers: adminListGolfPlayersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    name: 'The Open',
    venue: 'Royal Liverpool',
    location: 'Hoylake',
    startDate: '2026-07-16T08:00:00.000Z',
    endDate: '2026-07-19T20:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    releaseAt: '2026-07-01T00:00:00.000Z',
    fieldLocksAt: '2026-07-15T00:00:00.000Z',
    fieldLocked: false,
    seasonId: 'season-2026',
    leagueEventId: '',
    source: 'MANUAL',
    syncScope: 'NONE',
    scoreSource: { providerId: '', externalId: '' },
    autoLifecycleEnabled: true,
    par: 71,
    fieldCount: 2,
    tierCount: 6,
    contestCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workflow: { currentStatus: 'SCHEDULED', allowedTransitions: [] },
    ...overrides,
  };
}

function fieldEntry(overrides: Record<string, unknown> = {}) {
  return {
    sportEventParticipantId: 'sep-rory',
    participantId: 'p-rory',
    participantName: 'Rory McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    isActive: true,
    inactiveReason: null,
    worldRanking: 2,
    oddsToWin: 8.5,
    seedNumber: 2,
    price: 9500,
    isLeagueRosterMember: true,
    ...overrides,
  };
}

function seed(overrides: { tournament?: Record<string, unknown>; entries?: unknown[] } = {}) {
  adminGetGolfTournamentMock.mockResolvedValue({
    data: { tournament: tournament(overrides.tournament) },
  });
  adminGetGolfTournamentFieldMock.mockResolvedValue({
    data: {
      entries: overrides.entries ?? [
        fieldEntry(),
        fieldEntry({
          sportEventParticipantId: 'sep-guest',
          participantId: 'p-guest',
          participantName: 'Sponsor Exemption',
          isLeagueRosterMember: false,
          worldRanking: 400,
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

  it('pool-master-za4 renders read-only for a FULL provider-owned tournament', async () => {
    seed({ tournament: { syncScope: 'FULL' } });
    renderPage();

    expect(
      await screen.findByText(/fully provider-owned/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-field-seed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-field-add')).not.toBeInTheDocument();
  });

  it('pool-master-za4 surfaces the tournament load error', async () => {
    adminGetGolfTournamentMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such tournament' },
      response: { status: 404 },
    });
    adminGetGolfTournamentFieldMock.mockResolvedValue({ data: { entries: [] } });
    renderPage();

    expect(await screen.findByText('No such tournament')).toBeInTheDocument();
  });

  it('pool-master-za4 collects a world-rank edit and an activate toggle into one save call', async () => {
    seed();
    adminUpdateGolfFieldEntriesMock.mockResolvedValue({
      data: { entries: [fieldEntry({ worldRanking: 1 })] },
    });
    renderPage();

    const rankInput = await screen.findByTestId('root-admin-golf-field-worldRanking-sep-rory');
    await userEvent.clear(rankInput);
    await userEvent.type(rankInput, '1');

    await userEvent.click(screen.getByTestId('root-admin-golf-field-active-sep-guest'));
    // Reason select appears once a golfer is toggled inactive.
    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-field-reason-sep-guest'),
      'CUT',
    );

    expect(
      await screen.findByTestId('root-admin-golf-field-dirty-bar'),
    ).toHaveTextContent('2 unsaved rows');

    await userEvent.click(screen.getByTestId('root-admin-golf-field-save'));

    await waitFor(() =>
      expect(adminUpdateGolfFieldEntriesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: {
            entries: expect.arrayContaining([
              { sportEventParticipantId: 'sep-rory', worldRanking: 1 },
              {
                sportEventParticipantId: 'sep-guest',
                isActive: false,
                inactiveReason: 'CUT',
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

  it('pool-master-za4 seeds the field from the league roster behind a confirmation', async () => {
    seed();
    adminSeedGolfTournamentFieldMock.mockResolvedValue({
      data: { added: 140, skipped: 2, total: 142, seedNumbersDerived: 140, oddsDerived: 140 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-field-seed'));
    await userEvent.click(screen.getByTestId('root-admin-golf-field-seed-confirm'));

    await waitFor(() =>
      expect(adminSeedGolfTournamentFieldMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { eventId: 'evt-1' } }),
      ),
    );
    expect(
      await screen.findByTestId('root-admin-golf-field-seed-result'),
    ).toHaveTextContent('Added 140');
  });

  it('pool-master-za4 adds participants from a browsed league roster', async () => {
    seed();
    adminListGolfLeaguesMock.mockResolvedValue({
      data: {
        leagues: [
          {
            id: 'liv',
            sportId: 's',
            name: 'LIV Golf',
            matchKeyword: 'LIV',
            currentSeasonId: '',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            rosterSize: 2,
            seasonCount: 1,
          },
        ],
      },
    });
    adminGetGolfLeagueRosterMock.mockResolvedValue({
      data: {
        entries: [
          {
            participantId: 'p-jon',
            name: 'Jon Rahm',
            shortName: 'J. Rahm',
            nationality: 'ESP',
            status: 'ACTIVE',
            worldRanking: 3,
          },
          {
            participantId: 'p-rory',
            name: 'Rory McIlroy',
            shortName: 'R. McIlroy',
            nationality: 'NIR',
            status: 'ACTIVE',
            worldRanking: 2,
          },
        ],
      },
    });
    adminBulkAddGolfFieldEntriesMock.mockResolvedValue({
      data: { added: 1, skipped: 0, total: 1 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-field-add'));
    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-field-add-league'),
      'liv',
    );

    // Rory is already in the field -> excluded from the browse grid.
    await waitFor(() =>
      expect(screen.getByTestId('root-admin-golf-field-add-roster-row-p-jon')).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('root-admin-golf-field-add-roster-row-p-rory'),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('root-admin-golf-field-add-roster-select-p-jon'));
    await userEvent.click(screen.getByTestId('root-admin-golf-field-add-submit'));

    await waitFor(() =>
      expect(adminBulkAddGolfFieldEntriesMock).toHaveBeenCalledWith(
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
