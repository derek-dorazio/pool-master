import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContestDetailPage } from './contest-detail-page';

const {
  enterContestMock,
  getContestMock,
  listContestEntriesMock,
  listLeagueSquadsMock,
  mockLogger,
  updateContestEntryMock,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    enterContestMock: vi.fn(),
    getContestMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    listLeagueSquadsMock: vi.fn(),
    mockLogger: logger,
    updateContestEntryMock: vi.fn(),
  };
});

vi.mock('@/lib/api', () => ({
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  getContest: (...args: unknown[]) => getContestMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  listLeagueSquads: (...args: unknown[]) => listLeagueSquadsMock(...args),
  updateContestEntry: (...args: unknown[]) => updateContestEntryMock(...args),
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'member@example.com',
      username: 'member@example.com',
      firstName: 'Morgan',
      lastName: 'Member',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    clearSession: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderContestBoard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1' }]}
      >
        <Routes>
          <Route element={<ContestDetailPage />} path="/league/:leagueCode/contests/:contestId" />
          <Route
            element={<div data-testid="contest-entry-page" />}
            path="/league/:leagueCode/contests/:contestId/entries/:entryId"
          />
          <Route
            element={<div data-testid="contest-entry-page" />}
            path="/contests/:contestId/entries/:entryId"
          />
          <Route element={<div data-testid="league-page" />} path="/league/:leagueCode" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildEntry(overrides: Partial<{
  id: string;
  squadId: string;
  squadName: string;
  name: string;
  entryNumber: number;
  totalScore: number;
  standingsPosition: number | null;
  picksCount: number;
  participants: Array<{
    pickId: string;
    sportEventParticipantId: string;
    participantId: string;
    participantName: string;
    contestPoints: number;
    pickedAt: string;
    latestPerformance: Record<string, unknown>;
  }> | undefined;
}> = {}) {
  return {
    id: overrides.id ?? 'entry-1',
    contestId: 'contest-1',
    squadId: overrides.squadId ?? 'squad-1',
    squadName: overrides.squadName ?? 'Birdie Hunters',
    entryNumber: overrides.entryNumber ?? 1,
    name: overrides.name ?? 'Birdie Hunters Entry 1',
    status: 'ACTIVE' as const,
    tiebreakerValue: null,
    totalScore: overrides.totalScore ?? 0,
    standingsPosition: overrides.standingsPosition ?? null,
    isEliminated: false,
    picksCount: overrides.picksCount ?? 0,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...(overrides.participants !== undefined ? { participants: overrides.participants } : {}),
  };
}

function primeMocks(opts?: {
  contestStatus?: 'DRAFT' | 'OPEN' | 'DRAFTING' | 'LOCKED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  picksRevealed?: boolean;
  entries?: ReturnType<typeof buildEntry>[];
  myTeamId?: string;
}) {
  const contestStatus = opts?.contestStatus ?? 'OPEN';
  const picksRevealed = opts?.picksRevealed ?? (contestStatus !== 'OPEN' && contestStatus !== 'DRAFT');
  const entries = opts?.entries ?? [];
  const myTeamId = opts?.myTeamId ?? 'squad-1';
  const myEntries = entries.filter((entry) => entry.squadId === myTeamId);

  getContestMock.mockResolvedValue({
    data: {
      contest: {
        id: 'contest-1',
        name: 'Masters Pick 6',
        status: contestStatus,
        contestType: 'ROSTER',
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
        leagueId: 'league-1',
        sport: 'GOLF',
        entryCount: entries.length,
      },
    },
  });

  listContestEntriesMock.mockResolvedValue({
    data: {
      contestId: 'contest-1',
      total: entries.length,
      isJoined: myEntries.length > 0,
      myEntryId: myEntries[0]?.id ?? null,
      myEntryIds: myEntries.map((entry) => entry.id),
      picksRevealed,
      entries,
    },
  });

  listLeagueSquadsMock.mockResolvedValue({
    data: {
      squads: [
        {
          id: myTeamId,
          name: 'Birdie Hunters',
          leagueId: 'league-1',
          isActive: true,
          iconKey: 'CAPTAIN_SMILE_FIELD',
          isRootAdmin: false,
          teamRelationship: { owner: true, commissioner: false },
          members: [
            { userId: 'user-1', status: 'ACTIVE', firstName: 'Morgan', lastName: 'Member' },
          ],
        },
      ],
    },
  });
}

describe('ContestDetailPage (Contest Board)', () => {
  afterEach(() => {
    enterContestMock.mockReset();
    getContestMock.mockReset();
    listContestEntriesMock.mockReset();
    listLeagueSquadsMock.mockReset();
    updateContestEntryMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  // pool-master-dxd.13 — header summary counts ('My Entries: N · Total Entries: M').
  it('renders header counts for my entries and total entries', async () => {
    primeMocks({
      entries: [
        buildEntry({ id: 'entry-1', squadId: 'squad-1' }),
        buildEntry({ id: 'entry-2', squadId: 'squad-1', entryNumber: 2, name: 'Birdie Hunters Entry 2' }),
        buildEntry({ id: 'entry-3', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team Entry 1' }),
      ],
    });

    renderContestBoard();

    // myTeamId derives from listLeagueSquads which resolves after the initial
    // render. Wait for the count to update from the initial 0 to 2.
    await waitFor(() => {
      expect(screen.getByTestId('contest-board-my-count')).toHaveTextContent('My Entries: 2');
    });
    expect(screen.getByTestId('contest-board-total-count')).toHaveTextContent('Total Entries: 3');
  });

  // pool-master-dxd.13 — MY filter is client-side; total count stays unfiltered.
  it('filters rows when "My entries only" is toggled on', async () => {
    primeMocks({
      entries: [
        buildEntry({ id: 'entry-1', squadId: 'squad-1' }),
        buildEntry({ id: 'entry-3', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team Entry 1' }),
      ],
    });

    renderContestBoard();

    expect(await screen.findByTestId('contest-board-entry-entry-1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-board-entry-entry-3')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-board-my-only-toggle'));

    await waitFor(() => {
      expect(screen.queryByTestId('contest-board-entry-entry-3')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('contest-board-entry-entry-1')).toBeInTheDocument();

    // Header counts must NOT change with the toggle.
    expect(screen.getByTestId('contest-board-total-count')).toHaveTextContent('Total Entries: 2');
  });

  // pool-master-dxd.13 — own entries get the spotlight regardless of toggle state.
  it('spotlights the requester’s own entries', async () => {
    primeMocks({
      entries: [
        buildEntry({ id: 'entry-1', squadId: 'squad-1' }),
        buildEntry({ id: 'entry-3', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team Entry 1' }),
      ],
    });

    renderContestBoard();

    expect(await screen.findByTestId('contest-board-entry-spotlight-entry-1')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entry-spotlight-entry-3')).not.toBeInTheDocument();
  });

  // pool-master-dxd.13 — pre-event-start + non-owner: expand renders the
  // 'Picks hidden' placeholder and surfaces picksCount.
  it('renders the picks-hidden placeholder when expanding a non-owner row pre-event-start', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      entries: [
        buildEntry({
          id: 'entry-3',
          squadId: 'squad-other',
          squadName: 'Other Team',
          name: 'Other Team Entry 1',
          picksCount: 5,
        }),
      ],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-toggle-entry-3'));

    expect(await screen.findByTestId('contest-board-picks-hidden-entry-3')).toHaveTextContent(
      '5 picks made',
    );
    expect(screen.queryByTestId(/contest-leaderboard-participant-entry-3-/)).not.toBeInTheDocument();
  });

  // pool-master-dxd.13 — pre-event-start + owner: expand reveals owner's own picks.
  it('renders the owner’s own picks even when picks are not yet revealed league-wide', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      entries: [
        buildEntry({
          id: 'entry-1',
          squadId: 'squad-1',
          picksCount: 1,
          participants: [
            {
              pickId: 'pick-1',
              sportEventParticipantId: 'sep-1',
              participantId: 'participant-1',
              participantName: 'Tiger Woods',
              contestPoints: 0,
              pickedAt: '2026-04-15T00:00:00.000Z',
              latestPerformance: {},
            },
          ],
        }),
      ],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-toggle-entry-1'));

    expect(
      await screen.findByTestId('contest-leaderboard-participant-entry-1-participant-1'),
    ).toHaveTextContent('Tiger Woods');
    expect(screen.queryByTestId('contest-board-picks-hidden-entry-1')).not.toBeInTheDocument();
  });

  // pool-master-dxd.13 — post-event-start: picks are revealed for every row.
  it('reveals participant picks on every row once contest status moves past OPEN', async () => {
    primeMocks({
      contestStatus: 'LOCKED',
      picksRevealed: true,
      entries: [
        buildEntry({
          id: 'entry-3',
          squadId: 'squad-other',
          squadName: 'Other Team',
          name: 'Other Team Entry 1',
          picksCount: 1,
          participants: [
            {
              pickId: 'pick-3',
              sportEventParticipantId: 'sep-3',
              participantId: 'participant-3',
              participantName: 'Phil Mickelson',
              contestPoints: 0,
              pickedAt: '2026-04-15T00:00:00.000Z',
              latestPerformance: {},
            },
          ],
        }),
      ],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-toggle-entry-3'));

    expect(
      await screen.findByTestId('contest-leaderboard-participant-entry-3-participant-3'),
    ).toHaveTextContent('Phil Mickelson');
    expect(screen.queryByTestId('contest-board-picks-hidden-entry-3')).not.toBeInTheDocument();
  });

  // pool-master-dxd.13 — create-entry affordance: visible when contest is OPEN
  // and the viewer's team is in the league.
  it('shows the create-entry button when the contest is OPEN and the viewer has a team', async () => {
    primeMocks({ contestStatus: 'OPEN', entries: [] });

    renderContestBoard();

    expect(await screen.findByTestId('contest-board-create-entry')).toBeInTheDocument();
  });

  // pool-master-08k — creating an entry opens the guided selection flow immediately.
  it('navigates to the entry builder after creating a contest entry', async () => {
    primeMocks({ contestStatus: 'OPEN', entries: [] });
    enterContestMock.mockResolvedValue({
      data: {
        entry: buildEntry({ id: 'entry-1' }),
      },
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-create-entry'));

    expect(await screen.findByTestId('contest-entry-page')).toBeInTheDocument();
  });

  // pool-master-08k — existing own entries can be reopened for selection edits while OPEN.
  it('renders an edit entry icon for the owner while the contest is OPEN', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      entries: [buildEntry({ id: 'entry-1', squadId: 'squad-1' })],
    });

    renderContestBoard();

    expect(await screen.findByTestId('contest-board-edit-entry-entry-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1/entries/entry-1',
    );
  });

  it('hides the create-entry button when the contest is not OPEN', async () => {
    primeMocks({
      contestStatus: 'LOCKED',
      picksRevealed: true,
      entries: [],
    });

    renderContestBoard();

    await screen.findByTestId('contest-board-total-count');
    expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
  });

  // pool-master-dxd.13 — inline rename for the requester's own entries while OPEN.
  it('lets the owner rename their own entry inline while contest is OPEN', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      entries: [buildEntry({ id: 'entry-1', squadId: 'squad-1' })],
    });
    updateContestEntryMock.mockResolvedValue({
      data: { entry: { id: 'entry-1', name: 'My Renamed Entry' } },
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-rename-entry-1'));

    const input = await screen.findByTestId('contest-board-rename-input-entry-1');
    fireEvent.change(input, { target: { value: 'My Renamed Entry' } });
    fireEvent.click(screen.getByTestId('contest-board-rename-save-entry-1'));

    await waitFor(() => {
      expect(updateContestEntryMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1', entryId: 'entry-1' },
        body: { name: 'My Renamed Entry' },
      });
    });
  });
});
