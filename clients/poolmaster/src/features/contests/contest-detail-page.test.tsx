import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestDetailPage } from './contest-detail-page';

const {
  enterContestMock,
  getContestMock,
  getEventMock,
  listContestEntriesMock,
  getLeagueMock,
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
    getEventMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
    updateContestEntryMock: vi.fn(),
  };
});

bindApiMocks({
  enterContest: enterContestMock,
  getContest: getContestMock,
  getEvent: getEventMock,
  // #202 — the contest board reads the league BY ID for the viewer's own squad membership. It
  // used to list every squad in the league and scan each one's members for the signed-in user.
  getLeague: getLeagueMock,
  listContestEntries: listContestEntriesMock,
  updateContestEntry: updateContestEntryMock,
});

const VIEWER_USER = {
  id: 'user-1',
  email: 'member@example.com',
  username: 'member@example.com',
  firstName: 'Morgan',
  lastName: 'Member',
  isActive: true,
  isRootAdmin: false,
  createdAt: '2026-04-15T00:00:00.000Z',
} as const;

vi.mock('@/features/auth/auth-context', () => ({
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
  getOrCreateClientTraceId: () => 'test-trace-id',
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
          <Route
            element={<div data-testid="contest-leaderboard-page" />}
            path="/league/:leagueCode/contests/:contestId/leaderboard"
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
  picksCount: number;
  status: 'DRAFT' | 'SUBMITTED' | 'INACTIVE';
  participants: Array<{
    pickId: string;
    sportEventParticipantId: string;
    participantId: string;
    participantName: string;
    pickedAt: string;
  }> | undefined;
}> = {}) {
  return {
    id: overrides.id ?? 'entry-1',
    contestId: 'contest-1',
    squadId: overrides.squadId ?? 'squad-1',
    squadName: overrides.squadName ?? 'Birdie Hunters',
    entryNumber: overrides.entryNumber ?? 1,
    name: overrides.name ?? 'Birdie Hunters Entry 1',
    status: overrides.status ?? 'SUBMITTED',
    tiebreakerValue: null,
    picksCount: overrides.picksCount ?? 0,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    ...(overrides.participants !== undefined ? { participants: overrides.participants } : {}),
  };
}

function primeMocks(opts?: {
  contestStatus?: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED';
  picksRevealed?: boolean;
  entries?: ReturnType<typeof buildEntry>[];
  myTeamId?: string;
  role?: 'MEMBER' | 'COMMISSIONER';
  sportEventId?: string;
  endsAt?: string;
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
        ...(opts?.sportEventId ? { sportEventId: opts.sportEventId } : {}),
        ...(opts?.endsAt ? { endsAt: opts.endsAt } : {}),
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

  // #202 (A8) — the league context: the league plus the viewer's own edges in it, once. Which
  // squad is the viewer's is their `squadMembership`, not a flag on a squad row.
  getLeagueMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 3,
        activeContestCount: 1,
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      membership: {
        id: 'league-membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        user: VIEWER_USER,
        role: opts?.role ?? 'MEMBER',
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
      squadMembership: {
        id: 'squad-membership-1',
        squadId: myTeamId,
        leagueId: 'league-1',
        userId: 'user-1',
        user: VIEWER_USER,
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
}

describe('ContestDetailPage (Contest Board)', () => {
  afterEach(() => {
    enterContestMock.mockReset();
    getContestMock.mockReset();
    getEventMock.mockReset();
    listContestEntriesMock.mockReset();
    getLeagueMock.mockReset();
    updateContestEntryMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('shows a live contest as "Live" in the live colour, and its Status row reads "Live", never the raw enum', async () => {
    primeMocks({ contestStatus: 'ACTIVE' });

    renderContestBoard();

    await screen.findByRole('heading', { name: 'Masters Pick 6' });
    // The header badge comes first in the page, then the Status row in the rules section.
    const [badge, statusRow] = screen.getAllByText('Live');
    expect(badge).toHaveClass('shadow-[var(--shadow-red-pulse)]');
    expect(statusRow).toBeInTheDocument();
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
  });

  it('shows when the contest starts and ends, from its sport event\'s schedule', async () => {
    primeMocks({ sportEventId: 'event-1' });
    getEventMock.mockResolvedValue({
      data: {
        event: {
          id: 'event-1',
          startDate: '2026-04-09T12:00:00.000Z',
          endDate: '2026-04-12T23:00:00.000Z',
        },
      },
    });
    const format = (iso: string) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

    renderContestBoard();

    expect(await screen.findByTestId('contest-detail-starts')).toHaveTextContent(
      `Starts ${format('2026-04-09T12:00:00.000Z')}`,
    );
    expect(screen.getByTestId('contest-detail-ends')).toHaveTextContent(
      `Ends ${format('2026-04-12T23:00:00.000Z')}`,
    );
    expect(getEventMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'event-1' } }));
  });

  it('shows the contest\'s own end once it has one, over the event\'s scheduled end', async () => {
    primeMocks({ sportEventId: 'event-1', endsAt: '2026-04-14T18:00:00.000Z' });
    getEventMock.mockResolvedValue({
      data: {
        event: { id: 'event-1', startDate: '2026-04-09T12:00:00.000Z', endDate: '2026-04-12T23:00:00.000Z' },
      },
    });
    const format = (iso: string) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

    renderContestBoard();

    expect(await screen.findByTestId('contest-detail-ends')).toHaveTextContent(
      `Ends ${format('2026-04-14T18:00:00.000Z')}`,
    );
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

    // The viewer's squad comes from the league-context read, which resolves after the initial
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

  it('marks an unsubmitted entry Not submitted and leaves submitted entries unmarked', async () => {
    primeMocks({
      entries: [
        buildEntry({ id: 'entry-draft', name: 'Still Building', status: 'DRAFT' }),
        buildEntry({ id: 'entry-done', squadId: 'squad-2', name: 'Locked In', status: 'SUBMITTED' }),
      ],
    });

    renderContestBoard();

    expect(await screen.findByTestId('contest-board-entry-status-entry-draft')).toHaveTextContent('Not submitted');
    expect(screen.getByTestId('contest-board-entry-entry-done')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-entry-status-entry-done')).not.toBeInTheDocument();
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
    expect(screen.queryByTestId(/contest-entry-pick-entry-3-/)).not.toBeInTheDocument();
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
              pickedAt: '2026-04-15T00:00:00.000Z',
            },
          ],
        }),
      ],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-toggle-entry-1'));

    expect(
      await screen.findByTestId('contest-entry-pick-entry-1-participant-1'),
    ).toHaveTextContent('Tiger Woods');
    expect(screen.queryByTestId('contest-board-picks-hidden-entry-1')).not.toBeInTheDocument();
  });

  // pool-master-dxd.13 — post-event-start: picks are revealed for every row.
  it('reveals participant picks on every row once contest status moves past OPEN', async () => {
    primeMocks({
      contestStatus: 'ACTIVE',
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
              pickedAt: '2026-04-15T00:00:00.000Z',
            },
          ],
        }),
      ],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-toggle-entry-3'));

    expect(
      await screen.findByTestId('contest-entry-pick-entry-3-participant-3'),
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

  // #111 — this page never shows a score, revealed picks or not, so it never calls itself a
  // leaderboard. It links out to the page that does, once the endpoint behind it will answer.
  it('keeps one entry-focused heading whether or not picks are revealed', async () => {
    primeMocks({ contestStatus: 'OPEN', picksRevealed: false, entries: [] });

    const { unmount } = renderContestBoard();

    expect(await screen.findByRole('heading', { name: 'Entries' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leaderboard' })).not.toBeInTheDocument();
    unmount();

    primeMocks({ contestStatus: 'ACTIVE', picksRevealed: true, entries: [] });
    renderContestBoard();

    expect(await screen.findByRole('heading', { name: 'Entries' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leaderboard' })).not.toBeInTheDocument();
  });

  it('offers the leaderboard only once picks are revealed', async () => {
    primeMocks({ contestStatus: 'OPEN', picksRevealed: false, entries: [] });

    const { unmount } = renderContestBoard();

    await screen.findByTestId('contest-board-total-count');
    expect(screen.queryByTestId('contest-leaderboard-link')).not.toBeInTheDocument();
    unmount();

    primeMocks({ contestStatus: 'ACTIVE', picksRevealed: true, entries: [] });
    renderContestBoard();

    expect(await screen.findByTestId('contest-leaderboard-link')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1/leaderboard',
    );
  });

  // #246's note about standings frozen at settlement alongside live golfer scores moved to the
  // leaderboard page with the scores it describes; this page shows neither.
  it('does not claim anything about frozen standings, having none to show', async () => {
    primeMocks({ contestStatus: 'COMPLETED', entries: [] });

    renderContestBoard();

    await screen.findByTestId('contest-board-total-count');
    expect(screen.queryByTestId('contest-settled-note')).not.toBeInTheDocument();
  });

  // The server refuses new entries, renames and pick changes once the event's scheduled start
  // passes, even while the contest still reads OPEN because the In Progress update is late.
  it('offers no create, rename or edit on an OPEN contest once its event\'s scheduled start has passed', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      sportEventId: 'event-1',
      entries: [buildEntry({ id: 'entry-1', squadId: 'squad-1' })],
    });
    getEventMock.mockResolvedValue({
      data: {
        event: {
          id: 'event-1',
          startDate: new Date(Date.now() - 60 * 60_000).toISOString(),
          endDate: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
        },
      },
    });

    renderContestBoard();

    await screen.findByTestId('contest-detail-starts');
    await screen.findByTestId('contest-board-total-count');
    expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-rename-entry-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-board-edit-entry-entry-1')).not.toBeInTheDocument();
  });

  it('still offers create, rename and edit on an OPEN contest whose event starts later', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      sportEventId: 'event-1',
      entries: [buildEntry({ id: 'entry-1', squadId: 'squad-1' })],
    });
    getEventMock.mockResolvedValue({
      data: {
        event: {
          id: 'event-1',
          startDate: new Date(Date.now() + 60 * 60_000).toISOString(),
          endDate: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
        },
      },
    });

    renderContestBoard();

    await screen.findByTestId('contest-detail-starts');
    expect(await screen.findByTestId('contest-board-create-entry')).toBeInTheDocument();
    expect(screen.getByTestId('contest-board-rename-entry-1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-board-edit-entry-entry-1')).toBeInTheDocument();
  });

  it('hides the create-entry button when the contest is not OPEN', async () => {
    primeMocks({
      contestStatus: 'ACTIVE',
      picksRevealed: true,
      entries: [],
    });

    renderContestBoard();

    await screen.findByTestId('contest-board-total-count');
    expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
  });

  it('starts polling entries without a reload when an open contest goes live', async () => {
    // #362 — the contest read refreshes while the contest is not terminal, so the board
    // notices the event start and the entry poll keyed on ACTIVE begins on its own.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE', entries: [] });
      getContestMock.mockResolvedValueOnce({
        data: {
          contest: {
            id: 'contest-1',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 0,
          },
        },
      });
      renderContestBoard();
      await screen.findByText(/Total Entries/);
      const entryCallsWhileOpen = listContestEntriesMock.mock.calls.length;

      // The contest read that sees ACTIVE reads the entries straight away, not one interval on.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(listContestEntriesMock.mock.calls.length).toBeGreaterThan(entryCallsWhileOpen);
    } finally {
      vi.useRealTimers();
    }
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
  it('offers a commissioner "Open to league" on a draft, with the draft note, and no create-entry button', async () => {
    primeMocks({ contestStatus: 'DRAFT', role: 'COMMISSIONER' });

    renderContestBoard();

    expect(await screen.findByTestId('contest-open-to-league')).toBeInTheDocument();
    expect(screen.getByTestId('contest-draft-note')).toHaveTextContent(/only commissioners can see it/i);
    expect(screen.queryByTestId('contest-board-create-entry')).not.toBeInTheDocument();
  });

  it.each([
    ['a member on a draft', 'DRAFT', 'MEMBER'],
    ['a commissioner on an open contest', 'OPEN', 'COMMISSIONER'],
  ] as const)('offers no "Open to league" to %s', async (_who, contestStatus, role) => {
    primeMocks({ contestStatus, role });

    renderContestBoard();

    await screen.findByRole('heading', { name: 'Masters Pick 6' });
    await waitFor(() => expect(getLeagueMock).toHaveBeenCalled());
    expect(screen.queryByTestId('contest-open-to-league')).not.toBeInTheDocument();
  });

  it('shows why a new entry was refused and stays on the board', async () => {
    primeMocks({ contestStatus: 'OPEN', entries: [] });
    enterContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_LIMIT_REACHED', message: 'Your team already has the most entries allowed.' } },
      status: 409,
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-create-entry'));

    expect(await screen.findByTestId('contest-board-create-error')).toHaveTextContent(
      'Your team already has the most entries allowed.',
    );
    expect(screen.queryByTestId('contest-entry-page')).not.toBeInTheDocument();
  });

  it('keeps the rename open with the refusal shown when the name is refused, and restores it on cancel', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      entries: [buildEntry({ id: 'entry-1', squadId: 'squad-1' })],
    });
    updateContestEntryMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_NAME_TAKEN', message: 'Your team already has an entry with that name.' } },
      status: 409,
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-rename-entry-1'));
    fireEvent.change(await screen.findByTestId('contest-board-rename-input-entry-1'), {
      target: { value: 'Birdie Hunters Entry 2' },
    });
    fireEvent.click(screen.getByTestId('contest-board-rename-save-entry-1'));

    expect(await screen.findByText('Your team already has an entry with that name.')).toBeInTheDocument();
    expect(screen.getByTestId('contest-board-rename-input-entry-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-board-rename-cancel-entry-1'));
    expect(screen.queryByTestId('contest-board-rename-input-entry-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Your team already has an entry with that name.')).not.toBeInTheDocument();
  });

  it('shows the load error when the contest cannot be read', async () => {
    primeMocks();
    getContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_NOT_FOUND', message: 'No contest' } }, status: 404 });

    renderContestBoard();

    expect(await screen.findByText("We couldn't load this contest.")).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contestBoard.contest.failed' }),
      expect.any(String),
    );
  });

  it('shows an entries error, not an empty board, when the entries cannot be read', async () => {
    primeMocks();
    listContestEntriesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } }, status: 500 });

    renderContestBoard();

    expect(await screen.findByText("We couldn't load the current contest entries.")).toBeInTheDocument();
    expect(screen.queryByText('No contest entries exist yet.')).not.toBeInTheDocument();
  });

  it('says the team has no entry when "My entries only" is on and it has none', async () => {
    primeMocks({
      entries: [buildEntry({ id: 'entry-3', squadId: 'squad-other', squadName: 'Other Team', name: 'Other Team Entry 1' })],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-my-only-toggle'));

    expect(await screen.findByText('Your team does not have an entry in this contest yet.')).toBeInTheDocument();
  });

  it('says an own entry has no picks yet when it is opened before any golfer is chosen', async () => {
    primeMocks({
      contestStatus: 'OPEN',
      picksRevealed: false,
      entries: [buildEntry({ id: 'entry-1', squadId: 'squad-1', participants: [] })],
    });

    renderContestBoard();

    fireEvent.click(await screen.findByTestId('contest-board-toggle-entry-1'));

    expect(await screen.findByText('This entry does not have any picked participants yet.')).toBeInTheDocument();
  });
});
