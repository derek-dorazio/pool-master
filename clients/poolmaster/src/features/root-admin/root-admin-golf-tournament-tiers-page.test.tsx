import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentTiersPage } from './root-admin-golf-tournament-tiers-page';

// plans/124 §6.3 / §8 — Tier editor: assert the keyboard reassignment path
// (Move-to-tier Select + up/down), not only drag (pool-master-dyb).

const {
  adminGetGolfTournamentMock,
  adminGetGolfTournamentTiersMock,
  adminGetGolfTournamentFieldMock,
  adminReplaceGolfTierAssignmentsMock,
  adminReplaceGolfTournamentTiersMock,
  adminAutoAssignGolfTiersMock,
  adminAutoAssignGolfPricesMock,
  adminUpdateGolfFieldEntriesMock,
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
    adminGetGolfTournamentTiersMock: vi.fn(),
    adminGetGolfTournamentFieldMock: vi.fn(),
    adminReplaceGolfTierAssignmentsMock: vi.fn(),
    adminReplaceGolfTournamentTiersMock: vi.fn(),
    adminAutoAssignGolfTiersMock: vi.fn(),
    adminAutoAssignGolfPricesMock: vi.fn(),
    adminUpdateGolfFieldEntriesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminGetGolfTournament: adminGetGolfTournamentMock,
  adminGetGolfTournamentTiers: adminGetGolfTournamentTiersMock,
  adminGetGolfTournamentField: adminGetGolfTournamentFieldMock,
  adminReplaceGolfTierAssignments: adminReplaceGolfTierAssignmentsMock,
  adminReplaceGolfTournamentTiers: adminReplaceGolfTournamentTiersMock,
  adminAutoAssignGolfTiers: adminAutoAssignGolfTiersMock,
  adminAutoAssignGolfPrices: adminAutoAssignGolfPricesMock,
  adminUpdateGolfFieldEntries: adminUpdateGolfFieldEntriesMock,
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
    fieldCount: 3,
    tierCount: 2,
    contestCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workflow: { currentStatus: 'SCHEDULED', allowedTransitions: [] },
    ...overrides,
  };
}

function fieldEntry(sep: string, name: string, price = 9000) {
  return {
    sportEventParticipantId: sep,
    participantId: `p-${sep}`,
    participantName: name,
    shortName: name,
    nationality: 'NIR',
    isActive: true,
    inactiveReason: null,
    worldRanking: 3,
    oddsToWin: 8,
    seedNumber: 3,
    price,
    isLeagueRosterMember: true,
  };
}

function seed(overrides: { tournament?: Record<string, unknown> } = {}) {
  adminGetGolfTournamentMock.mockResolvedValue({
    data: { tournament: tournament(overrides.tournament) },
  });
  adminGetGolfTournamentFieldMock.mockResolvedValue({
    data: {
      entries: [
        fieldEntry('sep-1', 'Rory'),
        fieldEntry('sep-2', 'Scottie', 9800),
        fieldEntry('sep-3', 'Jon', 8500),
      ],
    },
  });
  adminGetGolfTournamentTiersMock.mockResolvedValue({
    data: {
      tiers: [
        {
          tierKey: 'tier-1',
          label: 'Tier 1',
          tierNumber: 1,
          defaultPickCount: 1,
          assignments: [
            { sportEventParticipantId: 'sep-1', participantId: 'p-sep-1', tierOrderIndex: 0, price: 9000 },
            { sportEventParticipantId: 'sep-2', participantId: 'p-sep-2', tierOrderIndex: 1, price: 9800 },
          ],
        },
        { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2, defaultPickCount: 1, assignments: [] },
        { tierKey: 'tier-3', label: 'Tier 3', tierNumber: 3, defaultPickCount: 1, assignments: [] },
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
      <MemoryRouter initialEntries={['/manage/golf/tournaments/evt-1/tiers']}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentTiersPage />}
            path="/manage/golf/tournaments/:eventId/tiers"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-dyb RootAdminGolfTournamentTiersPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-dyb renders tier columns, the Unassigned column, and the definitions panel', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-tier-column-tier-1')).toBeInTheDocument();
    const tier1 = screen.getByTestId('root-admin-golf-tier-column-tier-1');
    expect(within(tier1).getByText('Rory')).toBeInTheDocument();
    expect(within(tier1).getByText('Scottie')).toBeInTheDocument();
    const unassigned = screen.getByTestId('root-admin-golf-tier-column-__unassigned');
    expect(within(unassigned).getByText('Jon')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-tier-def-row-tier-1')).toBeInTheDocument();
  });

  it('pool-master-dyb reassigns a golfer via the "Move to tier" select and saves the full desired state', async () => {
    seed();
    adminReplaceGolfTierAssignmentsMock.mockResolvedValue({ data: null });
    renderPage();

    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-tier-move-sep-1'),
      'tier-2',
    );
    // sep-1 now shows under Tier 2.
    const tier2 = screen.getByTestId('root-admin-golf-tier-column-tier-2');
    await waitFor(() => expect(within(tier2).getByText('Rory')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('root-admin-golf-tier-board-save'));

    await waitFor(() =>
      expect(adminReplaceGolfTierAssignmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: {
            assignments: [
              { sportEventParticipantId: 'sep-2', tierKey: 'tier-1', tierOrderIndex: 0 },
              { sportEventParticipantId: 'sep-1', tierKey: 'tier-2', tierOrderIndex: 0 },
            ],
          },
        }),
      ),
    );
  });

  it('pool-master-dyb reorders within a tier with the up button', async () => {
    seed();
    adminReplaceGolfTierAssignmentsMock.mockResolvedValue({ data: null });
    renderPage();

    // sep-2 is second in tier-1; move it up.
    await userEvent.click(await screen.findByTestId('root-admin-golf-tier-up-sep-2'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-board-save'));

    await waitFor(() =>
      expect(adminReplaceGolfTierAssignmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            assignments: [
              { sportEventParticipantId: 'sep-2', tierKey: 'tier-1', tierOrderIndex: 0 },
              { sportEventParticipantId: 'sep-1', tierKey: 'tier-1', tierOrderIndex: 1 },
            ],
          },
        }),
      ),
    );
  });

  it('pool-master-dyb edits a price inline and saves it via the field bulk-patch', async () => {
    seed();
    adminUpdateGolfFieldEntriesMock.mockResolvedValue({ data: { entries: [] } });
    renderPage();

    const priceInput = await screen.findByTestId('root-admin-golf-tier-price-sep-1');
    await userEvent.clear(priceInput);
    await userEvent.type(priceInput, '12000');
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-board-save'));

    await waitFor(() =>
      expect(adminUpdateGolfFieldEntriesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: { entries: [{ sportEventParticipantId: 'sep-1', price: 12000 }] },
        }),
      ),
    );
  });

  it('pool-master-dyb auto-assigns tiers from world rank behind a confirmation', async () => {
    seed();
    adminAutoAssignGolfTiersMock.mockResolvedValue({ data: null });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-tier-auto-rank'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-auto-tiers-confirm'));

    await waitFor(() =>
      expect(adminAutoAssignGolfTiersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: { source: 'WORLD_RANK' },
        }),
      ),
    );
  });

  it('pool-master-dyb auto-assigns prices with a validated min/max range', async () => {
    seed();
    adminAutoAssignGolfPricesMock.mockResolvedValue({ data: null });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-tier-auto-prices'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-auto-prices-confirm'));

    await waitFor(() =>
      expect(adminAutoAssignGolfPricesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: { minPrice: 1000, maxPrice: 10000 },
        }),
      ),
    );
  });

  it('pool-master-dyb deletes a tier, reassigning its golfers to another tier', async () => {
    seed();
    adminReplaceGolfTournamentTiersMock.mockResolvedValue({ data: null });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-tier-def-delete-tier-1'));
    // tier-1 has 2 golfers -> reassignment target select appears (defaults to tier-2).
    expect(screen.getByTestId('root-admin-golf-tier-def-reassign')).toHaveValue('tier-2');
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-def-delete-confirm'));

    await waitFor(() =>
      expect(adminReplaceGolfTournamentTiersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: {
            tiers: [
              { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 1, defaultPickCount: 1 },
              { tierKey: 'tier-3', label: 'Tier 3', tierNumber: 2, defaultPickCount: 1 },
            ],
            reassignOrphansTo: 'tier-2',
          },
        }),
      ),
    );
  });

  it('pool-master-dyb renders read-only for a FULL provider-owned tournament', async () => {
    seed({ tournament: { syncScope: 'FULL' } });
    renderPage();

    expect(await screen.findByText(/fully provider-owned/i)).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tier-auto-rank')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tier-move-sep-1')).not.toBeInTheDocument();
  });

  it('pool-master-dyb warns when the tournament already has contests', async () => {
    seed({ tournament: { contestCount: 2 } });
    renderPage();
    expect(await screen.findByText(/rejected once any contest has entries/i)).toBeInTheDocument();
  });

  it('pool-master-dyb keeps an in-progress board edit across an identical refetch, and reseeds on a real server change (form-state-hazard)', async () => {
    seed();
    adminAutoAssignGolfTiersMock.mockResolvedValue({ data: null });
    renderPage();

    // Dirty the board.
    await userEvent.selectOptions(
      await screen.findByTestId('root-admin-golf-tier-move-sep-1'),
      'tier-2',
    );
    expect(screen.getByTestId('root-admin-golf-tier-board-dirty-bar')).toBeInTheDocument();

    // An unrelated action refetches tiers with IDENTICAL data -> edit survives.
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-auto-rank'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-auto-tiers-confirm'));
    await waitFor(() => expect(adminAutoAssignGolfTiersMock).toHaveBeenCalled());
    expect(screen.getByTestId('root-admin-golf-tier-board-dirty-bar')).toBeInTheDocument();
    const tier2 = screen.getByTestId('root-admin-golf-tier-column-tier-2');
    expect(within(tier2).getByText('Rory')).toBeInTheDocument();

    // Now the server actually changes (sep-1 landed in tier-2) -> board reseeds, dirty clears.
    adminGetGolfTournamentTiersMock.mockResolvedValue({
      data: {
        tiers: [
          {
            tierKey: 'tier-1',
            label: 'Tier 1',
            tierNumber: 1,
            defaultPickCount: 1,
            assignments: [
              { sportEventParticipantId: 'sep-2', participantId: 'p-sep-2', tierOrderIndex: 0, price: 9800 },
            ],
          },
          {
            tierKey: 'tier-2',
            label: 'Tier 2',
            tierNumber: 2,
            defaultPickCount: 1,
            assignments: [
              { sportEventParticipantId: 'sep-1', participantId: 'p-sep-1', tierOrderIndex: 0, price: 9000 },
            ],
          },
          { tierKey: 'tier-3', label: 'Tier 3', tierNumber: 3, defaultPickCount: 1, assignments: [] },
        ],
      },
    });
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-auto-rank'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-auto-tiers-confirm'));

    await waitFor(() =>
      expect(
        screen.queryByTestId('root-admin-golf-tier-board-dirty-bar'),
      ).not.toBeInTheDocument(),
    );
  });

  it('pool-master-dyb adds a tier without colliding with a sparse existing key set', async () => {
    adminGetGolfTournamentMock.mockResolvedValue({ data: { tournament: tournament() } });
    adminGetGolfTournamentFieldMock.mockResolvedValue({ data: { entries: [] } });
    adminGetGolfTournamentTiersMock.mockResolvedValue({
      data: {
        tiers: [
          { tierKey: 'tier-2', label: 'Tier A', tierNumber: 1, defaultPickCount: 1, assignments: [] },
          { tierKey: 'tier-3', label: 'Tier B', tierNumber: 2, defaultPickCount: 1, assignments: [] },
        ],
      },
    });
    adminReplaceGolfTournamentTiersMock.mockResolvedValue({ data: null });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-golf-tier-def-add'));
    await userEvent.click(screen.getByTestId('root-admin-golf-tier-def-save'));

    await waitFor(() =>
      expect(adminReplaceGolfTournamentTiersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            tiers: [
              { tierKey: 'tier-2', label: 'Tier A', tierNumber: 1, defaultPickCount: 1 },
              { tierKey: 'tier-3', label: 'Tier B', tierNumber: 2, defaultPickCount: 1 },
              // new key skips the taken tier-3 -> tier-4, not a duplicate.
              { tierKey: 'tier-4', label: 'Tier 3', tierNumber: 3, defaultPickCount: 1 },
            ],
          },
        }),
      ),
    );
  });

  it('pool-master-dyb surfaces the tiers load error', async () => {
    adminGetGolfTournamentMock.mockResolvedValue({ data: { tournament: tournament() } });
    adminGetGolfTournamentFieldMock.mockResolvedValue({ data: { entries: [] } });
    adminGetGolfTournamentTiersMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Tiers index offline' },
      response: { status: 500 },
    });
    renderPage();
    expect(await screen.findByText('Tiers index offline')).toBeInTheDocument();
  });
});
