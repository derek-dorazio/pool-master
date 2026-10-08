import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import { QueryKeys } from '@/lib/query-keys';

type DraftSelectionGroup = {
  groupId: string;
  groupName: string;
  groupNumber: number;
  picksFromGroup: number;
  selectedParticipantIds: string[];
  participants: Array<{
    sportEventParticipantId: string;
    participantId: string;
    participantName: string;
    role: string;
    team: string | null;
    status: string;
    price: number | null;
    ranking: number | null;
    orderIndex: number;
    isAvailable: boolean;
    unavailableReason: string | null;
    isSelected: boolean;
  }>;
};

const {
  getContestMock,
  getDraftStateMock,
  getEventMock,
  getLeagueMock,
  listContestEntriesMock,
  mockLogger,
  submitContestSelectionMock,
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
    getContestMock: vi.fn(),
    getDraftStateMock: vi.fn(),
    getEventMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
    submitContestSelectionMock: vi.fn(),
    updateContestEntryMock: vi.fn(),
  };
});

bindApiMocks({
  getContest: getContestMock,
  getDraftState: getDraftStateMock,
  getEvent: getEventMock,
  getLeague: getLeagueMock,
  listContestEntries: listContestEntriesMock,
  submitContestSelection: submitContestSelectionMock,
  updateContestEntry: updateContestEntryMock,
});

// #202 — the league-context hook reads `isRootAdmin` from the cached session user, so this
// page now touches auth. In the app it always renders inside `AuthProvider`; this test renders
// the page bare, so the hook is given a session directly.
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

function renderContestEntryPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/contests/contest-1/entries/entry-1',
            state: { leagueCode: 'BIGDAWGS' },
          },
        ]}
      >
        <Routes>
          <Route element={<ContestEntryPage />} path="/contests/:contestId/entries/:entryId" />
          <Route
            element={<div data-testid="contest-page" />}
            path="/league/:leagueCode/contests/:contestId"
          />
          <Route element={<div data-testid="league-page" />} path="/league/:leagueCode" />
          <Route element={<div data-testid="team-page" />} path="/league/:leagueCode/team" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return {
    ...view,
    queryClient,
  };
}

function primeCommonMocks(overrides?: {
  contestStatus?: 'OPEN' | 'DRAFTING' | 'LOCKED' | 'ACTIVE' | 'COMPLETED';
}) {
  getContestMock.mockResolvedValue({
    data: {
      contest: {
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Bohler Masters Tiered',
        status: overrides?.contestStatus ?? 'OPEN',
        contestType: 'ROSTER',
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
      },
    },
  });

  // #202 — `getLeague` returns the league CONTEXT now, the same shape as `getLeagueByCode`.
  // This page reads it for the league code its back link needs.
  getLeagueMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 2,
        activeContestCount: 1,
        joinPolicy: 'COMMISSIONER_ONLY',
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      membership: null,
      squadMembership: null,
    },
  });

  listContestEntriesMock.mockResolvedValue({
    data: {
      contestId: 'contest-1',
      total: 1,
      isJoined: true,
      myEntryId: 'entry-1',
      myEntryIds: ['entry-1'],
      entries: [
        {
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          squadName: 'Birdie Hunters',
          entryNumber: 1,
          name: 'Birdie Hunters Entry 1',
          status: 'ACTIVE',
          tiebreakerValue: 271,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      ],
    },
  });
}

function buildDraftState(selectionGroups: DraftSelectionGroup[]) {
  const totalPicks = selectionGroups.reduce((sum, group) => sum + group.picksFromGroup, 0);
  const selectedPicks = selectionGroups.reduce(
    (sum, group) => sum + group.selectedParticipantIds.length,
    0,
  );

  return {
    contestId: 'contest-1',
    contestName: 'Bohler Masters Tiered',
    selectionType: 'TIERED',
    isTurnBased: false,
    isCommissioner: false,
    rosterSize: totalPicks,
    contestConfiguration: {
      isExclusive: false,
      rosterSize: totalPicks,
      tierConfig: selectionGroups.map((group) => ({
        tierId: group.groupId,
        tierName: group.groupName,
        tierNumber: group.groupNumber,
        picksFromTier: group.picksFromGroup,
      })),
    },
    status: 'LIVE',
    currentPickNumber: 1,
    currentRound: 1,
    totalPicks,
    totalRounds: totalPicks,
    currentEntryId: 'entry-1',
    currentEntryName: 'Birdie Hunters Entry 1',
    myEntryId: 'entry-1',
    isMyPick: true,
    currentTurnStartedAt: null,
    timePerPickSeconds: 0,
    entries: [
      { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', isOnClock: false },
    ],
    selectedEntryId: 'entry-1',
    selectedEntryName: 'Birdie Hunters Entry 1',
    tiebreakerValue: null,
    selectionGroups,
    draftPickHistories: [],
    availableParticipantIds: selectionGroups.flatMap((group) =>
      group.participants.map((participant) => participant.sportEventParticipantId),
    ),
    isComplete: selectedPicks >= totalPicks,
  };
}

function buildGolfParticipant(id: string, name: string, orderIndex: number, isSelected: boolean) {
  return {
    sportEventParticipantId: id,
    participantId: `participant-${id}`,
    participantName: name,
    role: 'GOLFER',
    team: null,
    status: 'ACTIVE',
    price: null,
    ranking: orderIndex,
    orderIndex,
    isAvailable: true,
    unavailableReason: null,
    isSelected,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe('ContestEntryPage', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getDraftStateMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  // pool-master-08k — guided entry selection advances through tiers and submits the completed lineup.
  it('renders checkbox tier groups, advances focus, and submits the completed entry', async () => {
    primeCommonMocks();
    const selectedParticipantIdsByTier = new Map<string, string[]>([
      ['tier-1', []],
      ['tier-2', []],
    ]);
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    getDraftStateMock.mockImplementation(() => Promise.resolve({
      data: {
        contestId: 'contest-1',
        contestName: 'Bohler Masters Tiered',
        selectionType: 'TIERED',
        isTurnBased: false,
        isCommissioner: false,
        rosterSize: 2,
        contestConfiguration: {
          isExclusive: false,
          rosterSize: 2,
          tierConfig: [
            { tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 1 },
            { tierId: 'tier-2', tierName: 'Tier 2', tierNumber: 2, picksFromTier: 1 },
          ],
        },
        status: 'LIVE',
        currentPickNumber: 1,
        currentRound: 1,
        totalPicks: 2,
        totalRounds: 2,
        currentEntryId: 'entry-1',
        currentEntryName: 'Birdie Hunters Entry 1',
        myEntryId: 'entry-1',
        isMyPick: true,
        currentTurnStartedAt: null,
        timePerPickSeconds: 0,
        entries: [
          { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', isOnClock: false },
        ],
        selectedEntryId: 'entry-1',
        selectedEntryName: 'Birdie Hunters Entry 1',
        tiebreakerValue: null,
        selectionGroups: [
          {
            groupId: 'tier-1',
            groupName: 'Tier 1',
            groupNumber: 1,
            picksFromGroup: 1,
            selectedParticipantIds: selectedParticipantIdsByTier.get('tier-1') ?? [],
            participants: [
              {
                sportEventParticipantId: 'sep-1',
                participantId: 'participant-1',
                participantName: 'Scottie Scheffler',
                role: 'GOLFER',
                team: null,
                status: 'ACTIVE',
                price: null,
                ranking: 1,
                orderIndex: 1,
                isAvailable: true,
                unavailableReason: null,
                isSelected: selectedParticipantIdsByTier.get('tier-1')?.includes('sep-1') ?? false,
              },
            ],
          },
          {
            groupId: 'tier-2',
            groupName: 'Tier 2',
            groupNumber: 2,
            picksFromGroup: 1,
            selectedParticipantIds: selectedParticipantIdsByTier.get('tier-2') ?? [],
            participants: [
              {
                sportEventParticipantId: 'sep-2',
                participantId: 'participant-2',
                participantName: 'Rory McIlroy',
                role: 'GOLFER',
                team: null,
                status: 'ACTIVE',
                price: null,
                ranking: 2,
                orderIndex: 2,
                isAvailable: true,
                unavailableReason: null,
                isSelected: selectedParticipantIdsByTier.get('tier-2')?.includes('sep-2') ?? false,
              },
            ],
          },
        ],
        draftPickHistories: [],
        availableParticipantIds: ['sep-1', 'sep-2'],
        isComplete: Array.from(selectedParticipantIdsByTier.values()).every((ids) => ids.length > 0),
      },
    }));
    updateContestEntryMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        entry: {
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          squadName: 'Birdie Hunters',
          entryNumber: 1,
          name: 'Sunday Charge',
          status: 'ACTIVE',
          tiebreakerValue: -12,
          isEliminated: false,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      },
    });
    submitContestSelectionMock.mockImplementation(({ body }: { body: { participantId: string } }) => {
      if (body.participantId === 'sep-1') {
        selectedParticipantIdsByTier.set('tier-1', ['sep-1']);
      }
      if (body.participantId === 'sep-2') {
        selectedParticipantIdsByTier.set('tier-2', ['sep-2']);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- getDraftStateMock is an untyped vi.fn() (bindApiMocks expects a loose mock shape); this just forwards its mocked resolution.
      return getDraftStateMock();
    });

    renderContestEntryPage();

    expect(await screen.findByText('Build your lineup')).toBeInTheDocument();
    expect(screen.queryByText('Selection progress')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-group-tier-1')).toHaveClass('bg-muted/30');
    expect(screen.getByTestId('contest-entry-back-to-contest')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );
    expect(screen.queryByTestId('contest-entry-view-team-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-tiebreaker-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-group-toggle-tier-1')).toBeInTheDocument();
    expect(screen.queryByText('Rory McIlroy')).not.toBeInTheDocument();

    const scottieButton = await screen.findByTestId('contest-entry-participant-sep-1');
    expect(within(scottieButton).getByRole('checkbox')).toBeInTheDocument();
    fireEvent.click(scottieButton);

    await waitFor(() =>
      expect(submitContestSelectionMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1' },
        body: {
          entryId: 'entry-1',
          participantId: 'sep-1',
        },
      }),
    );
    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('contest-entry-group-toggle-tier-2')).toHaveFocus());
    expect(screen.getByText('Ranking #2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-entry-participant-sep-2'));
    expect(await screen.findByTestId('contest-entry-tiebreaker-select')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('contest-entry-name-input'), {
      target: { value: 'Sunday Charge' },
    });
    fireEvent.change(screen.getByTestId('contest-entry-tiebreaker-select'), {
      target: { value: '-12' },
    });
    fireEvent.click(screen.getByTestId('contest-entry-submit'));

    await waitFor(() =>
      expect(updateContestEntryMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1', entryId: 'entry-1' },
        body: {
          name: 'Sunday Charge',
          tiebreakerValue: -12,
        },
      }),
    );
    expect(await screen.findByTestId('contest-page')).toBeInTheDocument();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contestEntry.selection.succeeded',
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.20 preserves unsaved entry details across draft-state query refetches', async () => {
    primeCommonMocks();
    const selectionGroups = [
      {
        groupId: 'tier-1',
        groupName: 'Tier A',
        groupNumber: 1,
        picksFromGroup: 1,
        selectedParticipantIds: ['sep-1'],
        participants: [
          buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, true),
        ],
      },
    ];
    getDraftStateMock.mockResolvedValue({
      data: {
        ...buildDraftState(selectionGroups),
        tiebreakerValue: -8,
      },
    });

    const { queryClient } = renderContestEntryPage();

    await screen.findByTestId('contest-entry-name-input');
    fireEvent.change(screen.getByTestId('contest-entry-name-input'), {
      target: { value: 'Unsaved Sunday Charge' },
    });
    fireEvent.change(screen.getByTestId('contest-entry-tiebreaker-select'), {
      target: { value: '-12' },
    });
    getDraftStateMock.mockResolvedValueOnce({
      data: {
        ...buildDraftState(selectionGroups),
        selectedEntryName: 'Server Snapshot Entry',
        tiebreakerValue: -3,
      },
    });

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: QueryKeys.draftStates.detail('contest-1', 'entry-1') });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(QueryKeys.draftStates.detail('contest-1', 'entry-1'))).toMatchObject({
        selectedEntryName: 'Server Snapshot Entry',
        tiebreakerValue: -3,
      }),
    );

    expect(screen.getByTestId('contest-entry-name-input')).toHaveValue('Unsaved Sunday Charge');
    expect(screen.getByTestId('contest-entry-tiebreaker-select')).toHaveValue('-12');
  });

  it.each([
    [-12, '-12'],
    [0, 'E'],
  ])('shows read-only entry detail once the contest is locked, with a %i tiebreaker rendered as "%s"', async (tiebreakerValue, expectedText) => {
    primeCommonMocks({ contestStatus: 'LOCKED' });
    getDraftStateMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        contestName: 'Bohler Masters Tiered',
        selectionType: 'TIERED',
        isTurnBased: false,
        isCommissioner: false,
        rosterSize: 1,
        contestConfiguration: { isExclusive: false, rosterSize: 1, tierConfig: [] },
        status: 'COMPLETE',
        currentPickNumber: 1,
        currentRound: 1,
        totalPicks: 1,
        totalRounds: 1,
        currentEntryId: null,
        currentEntryName: null,
        myEntryId: 'entry-1',
        isMyPick: false,
        currentTurnStartedAt: null,
        timePerPickSeconds: 0,
        entries: [
          { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', isOnClock: false },
        ],
        selectedEntryId: 'entry-1',
        selectedEntryName: 'Birdie Hunters Entry 1',
        tiebreakerValue,
        selectionGroups: [
          {
            groupId: 'tier-1',
            groupName: 'Tier 1',
            groupNumber: 1,
            picksFromGroup: 1,
            selectedParticipantIds: ['sep-1'],
            participants: [
              {
                sportEventParticipantId: 'sep-1',
                participantId: 'participant-1',
                participantName: 'Scottie Scheffler',
                role: 'GOLFER',
                team: null,
                status: 'ACTIVE',
                price: null,
                ranking: 1,
                orderIndex: 1,
                isAvailable: true,
                unavailableReason: null,
                isSelected: true,
              },
            ],
          },
        ],
        draftPickHistories: [],
        availableParticipantIds: [],
        isComplete: true,
      },
    });

    renderContestEntryPage();

    expect(await screen.findByText('Saved lineup detail')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-readonly-tiebreaker')).toHaveTextContent(
      `Winning score relative to par: ${expectedText}`,
    );
    expect(screen.getByTestId('contest-entry-locked-participant-tier-1-sep-1')).toHaveTextContent(
      'Scottie Scheffler',
    );
    expect(screen.queryByTestId('contest-entry-save-details')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-participant-sep-1')).not.toBeInTheDocument();
  });

  it.each([
    // The entry's own status row shows ACTIVE for the entry, so the live case checks the old
    // page-only wording is gone instead.
    ['DRAFTING', 'Drafting', 'DRAFTING'],
    ['ACTIVE', 'Live', 'Scoring live'],
  ] as const)('labels a %s contest "%s" in the badge and Contest phase row, as on every contest page', async (contestStatus, label, replaced) => {
    primeCommonMocks({ contestStatus });
    getDraftStateMock.mockResolvedValue({ data: buildDraftState([]) });

    renderContestEntryPage();

    await screen.findByTestId('contest-entry-heading');
    expect(await screen.findAllByText(label)).toHaveLength(2);
    expect(screen.queryByText(replaced)).not.toBeInTheDocument();
  });

  it('shows the entry load failure state when the draft-state query fails', async () => {
    primeCommonMocks();
    getDraftStateMock.mockRejectedValue(new Error('Draft state unavailable'));

    renderContestEntryPage();

    await screen.findByText("We couldn't load this contest entry.");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contestEntry.load.failed',
      }),
      expect.any(String),
    );
  });

  // pool-master-mab — completed tiered entry groups must allow replacing and unselecting saved golfers.
  it('allows saved participants to be unselected and full tier selections to be replaced', async () => {
    primeCommonMocks();
    let selectedParticipantIds = ['sep-1', 'sep-2'];
    const buildSelectionGroups = () => [
      {
        groupId: 'tier-1',
        groupName: 'Tier A',
        groupNumber: 1,
        picksFromGroup: 2,
        selectedParticipantIds,
        participants: [
          buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, selectedParticipantIds.includes('sep-1')),
          buildGolfParticipant('sep-2', 'Rory McIlroy', 2, selectedParticipantIds.includes('sep-2')),
          buildGolfParticipant('sep-3', 'Jordan Spieth', 3, selectedParticipantIds.includes('sep-3')),
        ],
      },
    ];

    getDraftStateMock.mockImplementation(() =>
      Promise.resolve({ data: buildDraftState(buildSelectionGroups()) }),
    );
    submitContestSelectionMock.mockImplementation(({ body }: { body: { participantId: string } }) => {
      if (selectedParticipantIds.includes(body.participantId)) {
        selectedParticipantIds = selectedParticipantIds.filter((id) => id !== body.participantId);
      } else if (selectedParticipantIds.length >= 2) {
        selectedParticipantIds = [selectedParticipantIds[0], body.participantId];
      } else {
        selectedParticipantIds = [...selectedParticipantIds, body.participantId];
      }

      return Promise.resolve({ data: buildDraftState(buildSelectionGroups()) });
    });

    renderContestEntryPage();

    fireEvent.click(await screen.findByTestId('contest-entry-group-toggle-tier-1'));
    const jordanButton = await screen.findByTestId('contest-entry-participant-sep-3');
    expect(jordanButton).toBeEnabled();
    expect(jordanButton).toHaveTextContent('Replace selection');

    fireEvent.click(jordanButton);

    await waitFor(() =>
      expect(submitContestSelectionMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1' },
        body: {
          entryId: 'entry-1',
          participantId: 'sep-3',
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('contest-entry-group-toggle-tier-1')).toHaveTextContent('Jordan Spieth'),
    );
    expect(screen.getByTestId('contest-entry-group-toggle-tier-1')).not.toHaveTextContent('Rory McIlroy');

    fireEvent.click(screen.getByTestId('contest-entry-group-toggle-tier-1'));
    const scottieButton = screen.getByTestId('contest-entry-participant-sep-1');
    expect(scottieButton).toBeEnabled();
    expect(scottieButton).toHaveTextContent('Selected');

    fireEvent.click(scottieButton);

    await waitFor(() =>
      expect(submitContestSelectionMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1' },
        body: {
          entryId: 'entry-1',
          participantId: 'sep-1',
        },
      }),
    );
    expect(await screen.findByText('1/2 saved')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-participant-sep-1')).toHaveTextContent('Select golfer');
  });

  // pool-master-nt3 — entry selection must give immediate visual feedback while the save is in flight.
  it('updates the selected participant state before the selection request completes', async () => {
    primeCommonMocks();
    let selectedParticipantIds: string[] = [];
    const buildSelectionGroups = () => [
      {
        groupId: 'tier-1',
        groupName: 'Tier A',
        groupNumber: 1,
        picksFromGroup: 1,
        selectedParticipantIds,
        participants: [
          buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, selectedParticipantIds.includes('sep-1')),
        ],
      },
    ];
    const deferredSelection = createDeferred<{ data: ReturnType<typeof buildDraftState> }>();

    getDraftStateMock.mockImplementation(() =>
      Promise.resolve({ data: buildDraftState(buildSelectionGroups()) }),
    );
    submitContestSelectionMock.mockImplementation(() => deferredSelection.promise);

    renderContestEntryPage();

    const scottieButton = await screen.findByTestId('contest-entry-participant-sep-1');
    fireEvent.click(scottieButton);

    await waitFor(() => {
      expect(within(scottieButton).getByRole('checkbox')).toBeChecked();
      expect(scottieButton).toHaveTextContent('Selected');
    });

    selectedParticipantIds = ['sep-1'];
    deferredSelection.resolve({ data: buildDraftState(buildSelectionGroups()) });
  });
});

describe('ContestEntryPage — selection rules the server enforces', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getDraftStateMock.mockReset();
    getEventMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
  });

  function twoPickTier(selectedParticipantIds: string[]) {
    return {
      groupId: 'tier-1',
      groupName: 'Tier A',
      groupNumber: 1,
      picksFromGroup: 2,
      selectedParticipantIds,
      participants: [
        buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, selectedParticipantIds.includes('sep-1')),
        buildGolfParticipant('sep-2', 'Rory McIlroy', 2, selectedParticipantIds.includes('sep-2')),
        buildGolfParticipant('sep-3', 'Jordan Spieth', 3, selectedParticipantIds.includes('sep-3')),
      ],
    };
  }

  function historyRow(sportEventParticipantId: string, participantName: string, pickedAt: string) {
    return {
      pickNumber: 1,
      round: 1,
      pickInRound: 1,
      entryId: 'entry-1',
      entryName: 'Birdie Hunters Entry 1',
      participantId: sportEventParticipantId,
      participantName,
      isAutoPicked: false,
      pickedAt,
    };
  }

  // The server swaps out the tier's most recently picked golfer, not the one listed last.
  it('while a swap in a full tier is saving, drops the golfer picked most recently, as the server will', async () => {
    primeCommonMocks();
    // Listed in tier order Scottie then Rory, but Rory was picked first and Scottie second.
    const draftState = {
      ...buildDraftState([twoPickTier(['sep-1', 'sep-2'])]),
      draftPickHistories: [
        historyRow('sep-2', 'Rory McIlroy', '2026-04-15T10:00:00.000Z'),
        historyRow('sep-1', 'Scottie Scheffler', '2026-04-15T11:00:00.000Z'),
      ],
    };
    getDraftStateMock.mockResolvedValue({ data: draftState });
    const deferred = createDeferred<{ data: ReturnType<typeof buildDraftState> }>();
    submitContestSelectionMock.mockImplementation(() => deferred.promise);

    renderContestEntryPage();

    fireEvent.click(await screen.findByTestId('contest-entry-group-toggle-tier-1'));
    fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-3'));

    await waitFor(() => {
      expect(screen.getByTestId('contest-entry-participant-sep-3')).toHaveTextContent('Selected');
    });
    expect(screen.getByTestId('contest-entry-participant-sep-2')).toHaveTextContent('Selected');
    expect(screen.getByTestId('contest-entry-participant-sep-1')).not.toHaveTextContent('Selected');

    deferred.resolve({ data: buildDraftState([twoPickTier(['sep-2', 'sep-3'])]) });
  });

  it('puts the selection back and says why when the server refuses a pick', async () => {
    primeCommonMocks();
    getDraftStateMock.mockResolvedValue({ data: buildDraftState([twoPickTier(['sep-1'])]) });
    submitContestSelectionMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_LOCKED', message: 'Picks can no longer be changed.' } },
      response: { status: 409 },
    });

    renderContestEntryPage();

    // An unfinished tier opens on its own.
    fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-2'));

    expect(await screen.findByText('Picks can no longer be changed.')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-participant-sep-2')).not.toHaveTextContent('Selected');
    expect(screen.getByTestId('contest-entry-participant-sep-1')).toHaveTextContent('Selected');
  });

  function primeHiddenOtherTeamEntry() {
    primeCommonMocks();
    // The server answers the viewer's own entry when another team's is asked for before lock.
    getDraftStateMock.mockResolvedValue({
      data: {
        ...buildDraftState([twoPickTier(['sep-1'])]),
        entries: [
          { id: 'entry-1', userId: 'user-other', name: 'Other Team Entry 1', isOnClock: false },
          { id: 'entry-mine', userId: 'user-1', name: 'My Own Entry', isOnClock: false },
        ],
        selectedEntryId: 'entry-mine',
        selectedEntryName: 'My Own Entry',
        myEntryId: 'entry-mine',
      },
    });
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 2,
        isJoined: true,
        myEntryId: 'entry-mine',
        myEntryIds: ['entry-mine'],
        entries: [
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-other',
            squadName: 'Other Team',
            entryNumber: 1,
            name: 'Other Team Entry 1',
            status: 'ACTIVE',
            tiebreakerValue: null,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
        ],
      },
    });
  }

  it('shows another team\'s entry as hidden while the contest is open, rather than the viewer\'s own picks', async () => {
    primeHiddenOtherTeamEntry();

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-picks-hidden')).toHaveTextContent(
      'picks stay hidden until the contest locks',
    );
    expect(screen.getByTestId('contest-entry-heading')).toHaveTextContent('Other Team Entry 1');
    expect(screen.queryByText('Scottie Scheffler')).not.toBeInTheDocument();
    expect(screen.queryByText('My Own Entry')).not.toBeInTheDocument();
  });

  it("shows the summary tiles as hidden on another team's entry while the contest is open, not empty-lineup counts", async () => {
    primeHiddenOtherTeamEntry();

    renderContestEntryPage();

    await screen.findByTestId('contest-entry-picks-hidden');
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
    expect(screen.queryByText('Lineup is fully selected')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-tiebreaker-status')).toHaveTextContent('Hidden');
    expect(screen.getByTestId('contest-entry-tiebreaker-summary')).toHaveTextContent('Hidden until the contest locks');
    expect(screen.getAllByText('Hidden until the contest locks')).toHaveLength(4);
  });

  it('closes editing once the event has started, even while the contest still says open', async () => {
    primeCommonMocks();
    getContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-1',
          leagueId: 'league-1',
          name: 'Bohler Masters Tiered',
          status: 'OPEN',
          contestType: 'ROSTER',
          selectionType: 'TIERED',
          scoringEngine: 'STROKE_PLAY',
          sportEventId: 'event-1',
          startsAt: null,
        },
      },
    });
    getEventMock.mockResolvedValue({
      data: { event: { id: 'event-1', startDate: '2020-04-10T12:00:00.000Z', endDate: null } },
    });
    getDraftStateMock.mockResolvedValue({ data: buildDraftState([twoPickTier(['sep-1'])]) });

    renderContestEntryPage();

    await waitFor(() =>
      expect(screen.getByTestId('contest-entry-builder-heading')).toHaveTextContent('Saved lineup detail'),
    );
    expect(screen.queryByTestId('contest-entry-participant-sep-2')).not.toBeInTheDocument();
  });

  it('keeps editing open before the event\'s start time', async () => {
    primeCommonMocks();
    getContestMock.mockResolvedValue({
      data: {
        contest: {
          id: 'contest-1',
          leagueId: 'league-1',
          name: 'Bohler Masters Tiered',
          status: 'OPEN',
          contestType: 'ROSTER',
          selectionType: 'TIERED',
          scoringEngine: 'STROKE_PLAY',
          sportEventId: 'event-1',
          startsAt: null,
        },
      },
    });
    getEventMock.mockResolvedValue({
      data: { event: { id: 'event-1', startDate: '2099-04-10T12:00:00.000Z', endDate: null } },
    });
    getDraftStateMock.mockResolvedValue({ data: buildDraftState([twoPickTier(['sep-1'])]) });

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-builder-heading')).toHaveTextContent('Build your lineup');
  });

  it('shows a locked contest\'s lineup read-only, with the saved tiebreaker', async () => {
    primeCommonMocks({ contestStatus: 'LOCKED' });
    getDraftStateMock.mockResolvedValue({
      data: { ...buildDraftState([twoPickTier(['sep-1', 'sep-2'])]), tiebreakerValue: -6 },
    });

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-builder-heading')).toHaveTextContent('Saved lineup detail');
    expect(screen.getByTestId('contest-entry-readonly-tiebreaker')).toHaveTextContent('Winning score relative to par');
    expect(screen.queryByTestId('contest-entry-participant-sep-3')).not.toBeInTheDocument();
  });
});
