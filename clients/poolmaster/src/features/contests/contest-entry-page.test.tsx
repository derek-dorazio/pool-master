import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import { QueryKeys } from '@/lib/query-keys';

type SelectionGroup = {
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
    isSelected: boolean;
  }>;
};

const {
  getContestMock,
  getSelectionStateMock,
  getEventMock,
  getLeagueMock,
  listContestEntriesMock,
  mockLogger,
  submitContestEntryMock,
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
    getSelectionStateMock: vi.fn(),
    getEventMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
    submitContestEntryMock: vi.fn(),
    submitContestSelectionMock: vi.fn(),
    updateContestEntryMock: vi.fn(),
  };
});

bindApiMocks({
  getContest: getContestMock,
  getSelectionState: getSelectionStateMock,
  getEvent: getEventMock,
  getLeague: getLeagueMock,
  listContestEntries: listContestEntriesMock,
  submitContestEntry: submitContestEntryMock,
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

/** Far enough ahead that "has not started" holds whatever day the suite runs. */
const FUTURE_START = '2099-04-09T12:40:00.000Z';

/** One event of the contest, as the contest read names it (#713). */
function contestEventFixture(overrides: Record<string, unknown> = {}) {
  return {
    sportEventId: 'event-1',
    sequence: 1,
    name: 'The Masters',
    startDate: FUTURE_START,
    status: 'SCHEDULED',
    ...overrides,
  };
}

/** The contest read: a one-event golf contest unless `overrides` says otherwise. */
function contestFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contest-1',
    leagueId: 'league-1',
    sport: 'GOLF',
    name: 'Bohler Masters Tiered',
    status: 'OPEN',
    contestType: 'ROSTER',
    selectionType: 'TIERED',
    sportEvents: [contestEventFixture()],
    ...overrides,
  };
}

/** A listed entry's status in each contest event: a draft in the one event unless told otherwise. */
function entryEvents(status: 'DRAFT' | 'SUBMITTED' = 'DRAFT', sportEventId = 'event-1') {
  return [{ sportEventId, status, submittedAt: status === 'SUBMITTED' ? '2026-04-16T00:00:00.000Z' : null }];
}

function primeCommonMocks(overrides?: {
  contestStatus?: 'OPEN' | 'ACTIVE' | 'COMPLETED';
  /** The contest event's scheduled start; in the future unless given. */
  eventStartDate?: string;
}) {
  getContestMock.mockResolvedValue({
    data: {
      contest: contestFixture({
        status: overrides?.contestStatus ?? 'OPEN',
        sportEvents: [contestEventFixture(overrides?.eventStartDate ? { startDate: overrides.eventStartDate } : {})],
      }),
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
          events: entryEvents('DRAFT'),
          tiebreakerValue: 271,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
      ],
    },
  });
}

function buildSelectionState(selectionGroups: SelectionGroup[]) {
  const totalPicks = selectionGroups.reduce((sum, group) => sum + group.picksFromGroup, 0);
  const selectedPicks = selectionGroups.reduce(
    (sum, group) => sum + group.selectedParticipantIds.length,
    0,
  );

  return {
    contestId: 'contest-1',
    contestName: 'Bohler Masters Tiered',
    sportEventId: 'event-1',
    acceptsPicks: true,
    selectionType: 'TIERED',
    isCommissioner: false,
    rosterSize: totalPicks,
    status: 'LIVE',
    myEntryId: 'entry-1',
    entries: [
      { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', status: 'DRAFT' },
    ],
    selectedEntryId: 'entry-1',
    selectedEntryName: 'Birdie Hunters Entry 1',
    tiebreakerValue: null,
    selectionGroups,
    pickHistories: [],
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
    seedNumber: null,
    orderIndex,
    isAvailable: true,
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
    getSelectionStateMock.mockReset();
    getEventMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestEntryMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  // pool-master-08k — guided entry selection advances through tiers and submits the completed lineup.
  it('renders checkbox tier groups, advances focus, saves the tiebreaker and submits the completed entry', async () => {
    primeCommonMocks();
    const selectedParticipantIdsByTier = new Map<string, string[]>([
      ['tier-1', []],
      ['tier-2', []],
    ]);
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    getSelectionStateMock.mockImplementation(() => Promise.resolve({
      data: {
        contestId: 'contest-1',
        contestName: 'Bohler Masters Tiered',
        sportEventId: 'event-1',
        acceptsPicks: true,
        selectionType: 'TIERED',
        isCommissioner: false,
        rosterSize: 2,
        status: 'LIVE',
        myEntryId: 'entry-1',
        entries: [
          { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', status: 'DRAFT' },
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
                seedNumber: null,
                orderIndex: 1,
                isAvailable: true,
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
                seedNumber: null,
                orderIndex: 2,
                isAvailable: true,
                isSelected: selectedParticipantIdsByTier.get('tier-2')?.includes('sep-2') ?? false,
              },
            ],
          },
        ],
        pickHistories: [],
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
          events: entryEvents('DRAFT'),
          tiebreakerValue: -12,
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- getSelectionStateMock is an untyped vi.fn() (bindApiMocks expects a loose mock shape); this just forwards its mocked resolution.
      return getSelectionStateMock();
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- as above: forwards the untyped selection-state mock's resolution.
    submitContestEntryMock.mockImplementation(() => getSelectionStateMock());

    renderContestEntryPage();

    expect(await screen.findByText('Build your lineup')).toBeInTheDocument();
    expect(screen.queryByText('Selection progress')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-group-tier-1')).toHaveClass('bg-muted/30');
    expect(screen.getByTestId('contest-menu-entries')).toBeInTheDocument();
    expect(screen.getByTestId('contest-menu-my-entry')).toBeChecked();
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
    await waitFor(() =>
      expect(submitContestEntryMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' },
      }),
    );
    expect(updateContestEntryMock.mock.invocationCallOrder[0])
      .toBeLessThan(submitContestEntryMock.mock.invocationCallOrder[0]);
    expect(await screen.findByTestId('contest-page')).toBeInTheDocument();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contestEntry.selection.succeeded',
      }),
      expect.any(String),
    );
  });

  it('submits a complete horse racing entry with no tiebreaker to choose, since a race asks for no prediction', async () => {
    primeCommonMocks();
    getContestMock.mockResolvedValue({
      data: {
        contest: contestFixture({ sport: 'HORSE_RACING', name: 'Derby Pick 3' }),
      },
    });
    getSelectionStateMock.mockResolvedValue({
      data: buildSelectionState([
        {
          groupId: 'tier-1',
          groupName: 'Tier 1',
          groupNumber: 1,
          picksFromGroup: 1,
          selectedParticipantIds: ['sep-1'],
          participants: [{ ...buildGolfParticipant('sep-1', 'Sovereignty', 1, true), role: 'HORSE' }],
        },
      ]),
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- forwards the untyped selection-state mock's resolution.
    submitContestEntryMock.mockImplementation(() => getSelectionStateMock());

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-submit')).toBeEnabled();
    expect(screen.queryByTestId('contest-entry-tiebreaker-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-tiebreaker-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-not-submitted')).toHaveTextContent(
      'Your lineup is complete. Submit it: an entry only counts once it is submitted.',
    );
    expect(screen.getByTestId('contest-entry-group-tier-1')).toHaveTextContent('Choose 1 horse from this tier.');

    fireEvent.click(screen.getByTestId('contest-entry-submit'));

    await waitFor(() =>
      expect(submitContestEntryMock).toHaveBeenCalledWith({
        path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-1' },
      }),
    );
    expect(updateContestEntryMock).not.toHaveBeenCalled();
  });

  it('pool-master-rop.20 preserves unsaved entry details across selection-state query refetches', async () => {
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
    getSelectionStateMock.mockResolvedValue({
      data: {
        ...buildSelectionState(selectionGroups),
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
    getSelectionStateMock.mockResolvedValueOnce({
      data: {
        ...buildSelectionState(selectionGroups),
        selectedEntryName: 'Server Snapshot Entry',
        tiebreakerValue: -3,
      },
    });

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: QueryKeys.selectionStates.detail('contest-1', 'entry-1') });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(QueryKeys.selectionStates.detail('contest-1', 'entry-1'))).toMatchObject({
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
  ])('shows read-only entry detail once the contest is live, with a %i tiebreaker rendered as "%s"', async (tiebreakerValue, expectedText) => {
    primeCommonMocks({ contestStatus: 'ACTIVE' });
    getSelectionStateMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        contestName: 'Bohler Masters Tiered',
        sportEventId: 'event-1',
        // The event is under way, so the server takes no more pick changes.
        acceptsPicks: false,
        selectionType: 'TIERED',
        isCommissioner: false,
        rosterSize: 1,
        status: 'COMPLETE',
        myEntryId: 'entry-1',
        entries: [
          { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', status: 'DRAFT' },
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
                isSelected: true,
              },
            ],
          },
        ],
        pickHistories: [],
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

  // The old page-only wording for a live contest was "Scoring live"; it must be gone.
  it('labels an ACTIVE contest "Live" in the badge and Contest phase row, as on every contest page', async () => {
    primeCommonMocks({ contestStatus: 'ACTIVE' });
    getSelectionStateMock.mockResolvedValue({ data: { ...buildSelectionState([]), acceptsPicks: false } });

    renderContestEntryPage();

    await screen.findByTestId('contest-entry-heading');
    expect(await screen.findAllByText('Live')).toHaveLength(2);
    expect(screen.queryByText('Scoring live')).not.toBeInTheDocument();
  });

  // The server refuses picks once the event's scheduled start passes, even while the contest
  // still reads OPEN because the In Progress update is late.
  it('shows a read-only saved lineup once the event\'s scheduled start has passed, though the contest still reads OPEN', async () => {
    const startedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    primeCommonMocks({ eventStartDate: startedAt });
    getEventMock.mockResolvedValue({
      data: {
        event: {
          id: 'event-1',
          startDate: startedAt,
          endDate: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
        },
      },
    });
    getSelectionStateMock.mockResolvedValue({
      data: buildSelectionState([
        {
          groupId: 'tier-1',
          groupName: 'Tier 1',
          groupNumber: 1,
          picksFromGroup: 1,
          selectedParticipantIds: ['sep-1'],
          participants: [buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, true)],
        },
      ]),
    });

    renderContestEntryPage();

    await waitFor(() => expect(getEventMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('contest-entry-builder-heading')).toHaveTextContent('Saved lineup detail'),
    );
    expect(screen.queryByTestId('contest-entry-name-input')).not.toBeInTheDocument();
    expect(screen.queryByText('Editable until the event starts')).not.toBeInTheDocument();
  });

  it('shows the entry load failure state when the selection-state query fails', async () => {
    primeCommonMocks();
    getSelectionStateMock.mockRejectedValue(new Error('Selection state unavailable'));

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

    getSelectionStateMock.mockImplementation(() =>
      Promise.resolve({ data: buildSelectionState(buildSelectionGroups()) }),
    );
    submitContestSelectionMock.mockImplementation(({ body }: { body: { participantId: string } }) => {
      if (selectedParticipantIds.includes(body.participantId)) {
        selectedParticipantIds = selectedParticipantIds.filter((id) => id !== body.participantId);
      } else if (selectedParticipantIds.length >= 2) {
        selectedParticipantIds = [selectedParticipantIds[0], body.participantId];
      } else {
        selectedParticipantIds = [...selectedParticipantIds, body.participantId];
      }

      return Promise.resolve({ data: buildSelectionState(buildSelectionGroups()) });
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
    const deferredSelection = createDeferred<{ data: ReturnType<typeof buildSelectionState> }>();

    getSelectionStateMock.mockImplementation(() =>
      Promise.resolve({ data: buildSelectionState(buildSelectionGroups()) }),
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
    deferredSelection.resolve({ data: buildSelectionState(buildSelectionGroups()) });
  });

  it('keeps the member on the entry page with the refusal shown when saving the finished entry is refused', async () => {
    primeCommonMocks();
    getSelectionStateMock.mockResolvedValue({
      data: buildSelectionState([
        {
          groupId: 'tier-1',
          groupName: 'Tier 1',
          groupNumber: 1,
          picksFromGroup: 1,
          selectedParticipantIds: ['sep-1'],
          participants: [buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, true)],
        },
      ]),
    });
    updateContestEntryMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_LOCKED', message: 'Entries for this contest are closed.' } },
      status: 409,
    });

    renderContestEntryPage();

    fireEvent.change(await screen.findByTestId('contest-entry-tiebreaker-select'), {
      target: { value: '-12' },
    });
    fireEvent.click(screen.getByTestId('contest-entry-submit'));

    expect(await screen.findByText('Entries for this contest are closed.')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-page')).not.toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contestEntry.saveDetails.failed' }),
      expect.any(String),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('puts a refused pick back and shows the refusal, logged as a rejection rather than a crash', async () => {
    primeCommonMocks();
    getSelectionStateMock.mockResolvedValue({
      data: buildSelectionState([
        {
          groupId: 'tier-1',
          groupName: 'Tier 1',
          groupNumber: 1,
          picksFromGroup: 1,
          selectedParticipantIds: [],
          participants: [buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, false)],
        },
      ]),
    });
    submitContestSelectionMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_LOCKED', message: 'Entries for this contest are closed.' } },
      status: 409,
    });

    renderContestEntryPage();

    const scottie = await screen.findByTestId('contest-entry-participant-sep-1');
    fireEvent.click(scottie);

    expect(await screen.findByText('Entries for this contest are closed.')).toBeInTheDocument();
    expect(within(screen.getByTestId('contest-entry-participant-sep-1')).getByRole('checkbox')).not.toBeChecked();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contestEntry.selection.failed' }),
      expect.any(String),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

describe('ContestEntryPage — selection rules the server enforces', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getSelectionStateMock.mockReset();
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
    const selectionState = {
      ...buildSelectionState([twoPickTier(['sep-1', 'sep-2'])]),
      pickHistories: [
        historyRow('sep-2', 'Rory McIlroy', '2026-04-15T10:00:00.000Z'),
        historyRow('sep-1', 'Scottie Scheffler', '2026-04-15T11:00:00.000Z'),
      ],
    };
    getSelectionStateMock.mockResolvedValue({ data: selectionState });
    const deferred = createDeferred<{ data: ReturnType<typeof buildSelectionState> }>();
    submitContestSelectionMock.mockImplementation(() => deferred.promise);

    renderContestEntryPage();

    fireEvent.click(await screen.findByTestId('contest-entry-group-toggle-tier-1'));
    fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-3'));

    await waitFor(() => {
      expect(screen.getByTestId('contest-entry-participant-sep-3')).toHaveTextContent('Selected');
    });
    expect(screen.getByTestId('contest-entry-participant-sep-2')).toHaveTextContent('Selected');
    expect(screen.getByTestId('contest-entry-participant-sep-1')).not.toHaveTextContent('Selected');

    deferred.resolve({ data: buildSelectionState([twoPickTier(['sep-2', 'sep-3'])]) });
  });

  it('puts the selection back and says why when the server refuses a pick', async () => {
    primeCommonMocks();
    getSelectionStateMock.mockResolvedValue({ data: buildSelectionState([twoPickTier(['sep-1'])]) });
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
    getSelectionStateMock.mockResolvedValue({
      data: {
        ...buildSelectionState([twoPickTier(['sep-1'])]),
        entries: [
          { id: 'entry-1', userId: 'user-other', name: 'Other Team Entry 1', status: 'DRAFT' },
          { id: 'entry-mine', userId: 'user-1', name: 'My Own Entry', status: 'DRAFT' },
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
            events: entryEvents('DRAFT'),
            tiebreakerValue: null,
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
      'picks stay hidden until the event starts',
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
    expect(screen.getByTestId('contest-entry-tiebreaker-summary')).toHaveTextContent('Hidden until the event starts');
    expect(screen.getAllByText('Hidden until the event starts')).toHaveLength(4);
  });

  it('closes editing once the event has started, even while the contest still says open', async () => {
    primeCommonMocks({ eventStartDate: '2020-04-10T12:00:00.000Z' });
    getEventMock.mockResolvedValue({
      data: { event: { id: 'event-1', startDate: '2020-04-10T12:00:00.000Z', endDate: null } },
    });
    getSelectionStateMock.mockResolvedValue({ data: buildSelectionState([twoPickTier(['sep-1'])]) });

    renderContestEntryPage();

    await waitFor(() =>
      expect(screen.getByTestId('contest-entry-builder-heading')).toHaveTextContent('Saved lineup detail'),
    );
    expect(screen.queryByTestId('contest-entry-participant-sep-2')).not.toBeInTheDocument();
  });

  it('keeps editing open before the event\'s start time', async () => {
    primeCommonMocks({ eventStartDate: '2099-04-10T12:00:00.000Z' });
    getEventMock.mockResolvedValue({
      data: { event: { id: 'event-1', startDate: '2099-04-10T12:00:00.000Z', endDate: null } },
    });
    getSelectionStateMock.mockResolvedValue({ data: buildSelectionState([twoPickTier(['sep-1'])]) });

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-builder-heading')).toHaveTextContent('Build your lineup');
  });

  it('shows a live contest\'s lineup read-only, with the saved tiebreaker', async () => {
    primeCommonMocks({ contestStatus: 'ACTIVE' });
    getSelectionStateMock.mockResolvedValue({
      data: { ...buildSelectionState([twoPickTier(['sep-1', 'sep-2'])]), acceptsPicks: false, tiebreakerValue: -6 },
    });

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-builder-heading')).toHaveTextContent('Saved lineup detail');
    expect(screen.getByTestId('contest-entry-readonly-tiebreaker')).toHaveTextContent('Winning score relative to par');
    expect(screen.queryByTestId('contest-entry-participant-sep-3')).not.toBeInTheDocument();
  });
  describe('submitting an entry', () => {
    const completeGroups = () => [
      {
        groupId: 'tier-1',
        groupName: 'Tier 1',
        groupNumber: 1,
        picksFromGroup: 1,
        selectedParticipantIds: ['sep-1'],
        participants: [buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, true)],
      },
    ];

    function selectionStateWithStatus(status: 'DRAFT' | 'SUBMITTED', groups = completeGroups()) {
      return {
        ...buildSelectionState(groups),
        entries: [{ id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', status }],
      };
    }

    it('marks a complete but unsubmitted entry Not submitted and says it only counts once submitted', async () => {
      primeCommonMocks();
      getSelectionStateMock.mockResolvedValue({ data: selectionStateWithStatus('DRAFT') });

      renderContestEntryPage();

      expect(await screen.findByTestId('contest-entry-status-badge')).toHaveTextContent('Not submitted');
      expect(screen.getByTestId('contest-entry-not-submitted')).toHaveTextContent('only counts once it is submitted');
      expect(screen.getByTestId('contest-entry-submit')).toHaveTextContent('Submit entry');
    });

    it('marks a submitted entry Submitted, with no warning and a Save entry action', async () => {
      primeCommonMocks();
      getSelectionStateMock.mockResolvedValue({ data: selectionStateWithStatus('SUBMITTED') });

      renderContestEntryPage();

      expect(await screen.findByTestId('contest-entry-status-badge')).toHaveTextContent('Submitted');
      expect(screen.queryByTestId('contest-entry-not-submitted')).not.toBeInTheDocument();
      expect(screen.getByTestId('contest-entry-submit')).toHaveTextContent('Save entry');
    });

    it('shows the entry back as Not submitted when unselecting a golfer leaves a submitted lineup short', async () => {
      primeCommonMocks();
      getSelectionStateMock.mockResolvedValue({ data: selectionStateWithStatus('SUBMITTED') });
      submitContestSelectionMock.mockResolvedValue({
        data: selectionStateWithStatus('DRAFT', [
          { ...completeGroups()[0], selectedParticipantIds: [], participants: [buildGolfParticipant('sep-1', 'Scottie Scheffler', 1, false)] },
        ]),
      });

      renderContestEntryPage();

      expect(await screen.findByTestId('contest-entry-status-badge')).toHaveTextContent('Submitted');
      fireEvent.click(screen.getByTestId('contest-entry-group-toggle-tier-1'));
      fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-1'));

      await waitFor(() =>
        expect(screen.getByTestId('contest-entry-status-badge')).toHaveTextContent('Not submitted'));
      expect(screen.getByTestId('contest-entry-not-submitted')).toHaveTextContent('needs submitting again');
    });

    it('stays on the page and shows the server\'s reason when a submit is refused, logged as a rejection', async () => {
      primeCommonMocks();
      getSelectionStateMock.mockResolvedValue({ data: selectionStateWithStatus('DRAFT') });
      updateContestEntryMock.mockResolvedValue({
        data: {
          contestId: 'contest-1',
          entry: {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            squadName: 'Birdie Hunters',
            entryNumber: 1,
            name: 'Birdie Hunters Entry 1',
            events: entryEvents('DRAFT'),
            tiebreakerValue: -12,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-16T00:00:00.000Z',
          },
        },
      });
      submitContestEntryMock.mockResolvedValue({
        error: {
          error: {
            code: 'ENTRY_LINEUP_INCOMPLETE',
            message: 'Entry entry-1 cannot be submitted until every tier is filled: Tier 2 still need picks',
          },
        },
        status: 409,
      });

      renderContestEntryPage();

      fireEvent.change(await screen.findByTestId('contest-entry-tiebreaker-select'), {
        target: { value: '-12' },
      });
      fireEvent.click(screen.getByTestId('contest-entry-submit'));

      expect(await screen.findByTestId('contest-entry-submit-error')).toHaveTextContent('Tier 2 still need picks');
      expect(screen.queryByTestId('contest-page')).not.toBeInTheDocument();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'contestEntry.submit.failed' }),
        expect.any(String),
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});

describe('ContestEntryPage — a budget entry (#93)', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getSelectionStateMock.mockReset();
    getEventMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestEntryMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
  });

  // Two golfers under a $15,000 cap. Scheffler $9,000, McIlroy $7,000, Spieth $4,000.
  const PRICES: Record<string, number> = { 'sep-1': 9000, 'sep-2': 7000, 'sep-3': 4000 };
  const NAMES: Record<string, string> = { 'sep-1': 'Scottie Scheffler', 'sep-2': 'Rory McIlroy', 'sep-3': 'Jordan Spieth' };

  function budgetState(selectedParticipantIds: string[], summary: Record<string, unknown> = {}) {
    const field = {
      groupId: 'field',
      groupName: 'Field',
      groupNumber: 1,
      picksFromGroup: 2,
      selectedParticipantIds,
      participants: Object.keys(PRICES).map((id, index) => ({
        ...buildGolfParticipant(id, NAMES[id] ?? id, index + 1, selectedParticipantIds.includes(id)),
        price: PRICES[id] ?? null,
      })),
    };
    const spent = selectedParticipantIds.reduce((sum, id) => sum + (PRICES[id] ?? 0), 0);
    return {
      ...buildSelectionState([field]),
      selectionType: 'BUDGET_PICK',
      lineupSummary: {
        selectionType: 'BUDGET_PICK',
        salaryCap: 15000,
        spent,
        remaining: 15000 - spent,
        isOverBudget: spent > 15000,
        openSlots: 2 - selectedParticipantIds.length,
        cheapestFill: selectedParticipantIds.length === 2 ? 0 : 4000,
        ...summary,
      },
    };
  }

  function primeBudgetMocks(selectedParticipantIds: string[], summary?: Record<string, unknown>) {
    primeCommonMocks();
    getContestMock.mockResolvedValue({
      data: {
        contest: contestFixture({ name: 'Bohler Masters Budget', selectionType: 'BUDGET_PICK' }),
      },
    });
    getSelectionStateMock.mockResolvedValue({ data: budgetState(selectedParticipantIds, summary) });
  }

  it('lists the field with prices and shows the spend against the cap, with what is left per open place', async () => {
    primeBudgetMocks(['sep-2']);

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-spend-bar')).toHaveTextContent('Spent $7,000 of $15,000');
    expect(screen.getByTestId('contest-entry-budget-remaining')).toHaveTextContent('$8,000 left');
    expect(screen.getByTestId('contest-entry-budget-per-place')).toHaveTextContent('About $8,000 per place');
    expect(screen.getByTestId('contest-entry-participant-sep-1')).toHaveTextContent('$9,000');
    expect(screen.getByTestId('contest-entry-selected-sep-2')).toHaveTextContent('Rory McIlroy · $7,000');
    expect(screen.queryByText('This contest can\'t be entered here.')).not.toBeInTheDocument();
  });

  it('adds a golfer that takes the entry over the cap, then turns the spend red and keeps Submit disabled with the reason', async () => {
    primeBudgetMocks(['sep-2']);
    const deferred = createDeferred<unknown>();
    submitContestSelectionMock.mockReturnValue(deferred.promise);

    renderContestEntryPage();

    fireEvent.click(await screen.findByTestId('contest-entry-participant-sep-1'));

    // Before the server answers, the spend already counts Scheffler.
    expect(await screen.findByTestId('contest-entry-over-budget')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-budget-remaining')).toHaveTextContent('$1,000 over the cap');
    expect(submitContestSelectionMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { entryId: 'entry-1', participantId: 'sep-1' },
    }));

    await act(async () => {
      deferred.resolve({ data: budgetState(['sep-2', 'sep-1']) });
      await deferred.promise;
    });
    fireEvent.change(screen.getByTestId('contest-entry-tiebreaker-select'), { target: { value: '-12' } });

    expect(screen.getByTestId('contest-entry-submit-blocked')).toHaveTextContent(
      'Your picks cost $16,000, over the $15,000 salary cap. Remove one to get under it, then submit.',
    );
    expect(screen.getByTestId('contest-entry-submit')).toBeDisabled();
  });

  it('counts the golfers still to pick in the singular when one place is left', async () => {
    primeBudgetMocks(['sep-2']);

    renderContestEntryPage();

    expect(await screen.findByText('1 golfer still to pick')).toBeInTheDocument();
    expect(screen.queryByText('1 golfers still to pick')).not.toBeInTheDocument();
  });

  it('shows a dash, not Hidden, on the Spent tile when the picks are visible but the server sent no spend', async () => {
    primeBudgetMocks(['sep-2']);
    getSelectionStateMock.mockResolvedValue({ data: { ...budgetState(['sep-2']), lineupSummary: null } });

    renderContestEntryPage();

    expect(await screen.findByText('Spent')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('removes a picked golfer when their chip is tapped', async () => {
    primeBudgetMocks(['sep-1', 'sep-2']);
    submitContestSelectionMock.mockResolvedValue({ data: budgetState(['sep-1']) });

    renderContestEntryPage();

    fireEvent.click(await screen.findByTestId('contest-entry-selected-sep-2'));

    await waitFor(() => expect(submitContestSelectionMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { entryId: 'entry-1', participantId: 'sep-2' },
    })));
    await waitFor(() => expect(screen.queryByTestId('contest-entry-selected-sep-2')).not.toBeInTheDocument());
  });

  it('holds new golfers back once the roster is full, so the only way in is to remove someone', async () => {
    primeBudgetMocks(['sep-2', 'sep-3']);

    renderContestEntryPage();

    const scheffler = await screen.findByTestId('contest-entry-participant-sep-1');
    expect(scheffler).toBeDisabled();
    expect(scheffler).toHaveTextContent('Roster full');
    expect(screen.getByTestId('contest-entry-participant-sep-2')).toBeEnabled();
  });

  it('narrows the price list to golfers whose name matches the search', async () => {
    primeBudgetMocks([]);

    renderContestEntryPage();

    fireEvent.change(await screen.findByTestId('contest-entry-budget-search'), { target: { value: 'spie' } });

    expect(screen.getByTestId('contest-entry-participant-sep-3')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-participant-sep-1')).not.toBeInTheDocument();
  });

  it('warns, without blocking, when the cheapest golfers left cost more than is left for the open places', async () => {
    primeBudgetMocks(['sep-1'], { cheapestFill: 7000, remaining: 6000 });

    renderContestEntryPage();

    expect(await screen.findByTestId('contest-entry-budget-unfillable')).toHaveTextContent(
      'The cheapest golfers left for your 1 place cost $7,000, more than you have left.',
    );
    expect(screen.getByTestId('contest-entry-participant-sep-3')).toBeEnabled();
  });

  it('says in plain words when the server refuses to submit an entry over the cap', async () => {
    primeBudgetMocks(['sep-2', 'sep-3']);
    updateContestEntryMock.mockResolvedValue({ data: { entry: { id: 'entry-1' } } });
    submitContestEntryMock.mockResolvedValue({
      error: { error: { code: 'ENTRY_OVER_BUDGET', message: 'server sentence' } },
      status: 409,
    });

    renderContestEntryPage();

    fireEvent.change(await screen.findByTestId('contest-entry-tiebreaker-select'), { target: { value: '-12' } });
    fireEvent.click(screen.getByTestId('contest-entry-submit'));

    expect(await screen.findByTestId('contest-entry-submit-error')).toHaveTextContent(
      'Your picks cost more than the salary cap. Remove one to get under it, then submit.',
    );
  });
});

describe('ContestEntryPage — a random-draw entry', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getSelectionStateMock.mockReset();
    getEventMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestEntryMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
  });

  const NAMES: Record<string, string> = { 'sep-1': 'Scottie Scheffler', 'sep-2': 'Rory McIlroy', 'sep-3': 'Jordan Spieth' };

  function drawState(dealtIds: string[], drawnAt: string | null) {
    const field = {
      groupId: 'field',
      groupName: 'Field',
      groupNumber: 1,
      picksFromGroup: 2,
      selectedParticipantIds: dealtIds,
      participants: Object.keys(NAMES).map((id, index) =>
        buildGolfParticipant(id, NAMES[id] ?? id, index + 1, dealtIds.includes(id))),
    };
    return {
      ...buildSelectionState([field]),
      selectionType: 'RANDOM_DRAW',
      drawnAt,
      // A dealt contest takes no more pick changes.
      acceptsPicks: drawnAt === null,
      entries: [
        { id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', status: drawnAt ? 'SUBMITTED' : 'DRAFT' },
      ],
    };
  }

  function primeDrawMocks(dealtIds: string[], drawnAt: string | null) {
    primeCommonMocks();
    getContestMock.mockResolvedValue({
      data: {
        contest: contestFixture({ name: 'Masters Sweepstake', selectionType: 'RANDOM_DRAW' }),
      },
    });
    getSelectionStateMock.mockResolvedValue({ data: drawState(dealtIds, drawnAt) });
  }

  it('before the draw, says the commissioner\'s draw will deal the entry its golfers and offers nothing to pick or submit', async () => {
    primeDrawMocks([], null);

    renderContestEntryPage();

    const pending = await screen.findByTestId('contest-entry-draw-pending');
    expect(pending).toHaveTextContent('There is nothing to pick in this contest.');
    expect(pending).toHaveTextContent('the commissioner runs the draw, which deals this entry 2 golfers at random and enters it.');
    expect(screen.getByTestId('contest-entry-draw-status')).toHaveTextContent('Not yet run');
    expect(screen.getByText('Open until the draw', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Scottie Scheffler')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-not-submitted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-name-input')).not.toBeInTheDocument();
  });

  it('after the draw, lists only the golfers the entry was dealt, read-only, with entries closed', async () => {
    primeDrawMocks(['sep-1', 'sep-3'], '2026-04-08T15:00:00.000Z');

    renderContestEntryPage();

    const dealt = await screen.findByRole('list', { name: 'Dealt golfers' });
    expect(within(dealt).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Scottie Scheffler', 'Jordan Spieth']);
    expect(screen.queryByText('Rory McIlroy')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-draw-done')).toHaveTextContent('The draw is final.');
    expect(screen.getByTestId('contest-entry-draw-status')).toHaveTextContent('Done');
    expect(screen.getByRole('heading', { name: 'Dealt golfers' })).toBeInTheDocument();
    expect(screen.getAllByText('Entries closed').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-draw-pending')).not.toBeInTheDocument();
  });
});

describe('ContestEntryPage — a contest of two events', () => {
  afterEach(() => {
    getContestMock.mockReset();
    getSelectionStateMock.mockReset();
    getEventMock.mockReset();
    getLeagueMock.mockReset();
    listContestEntriesMock.mockReset();
    submitContestEntryMock.mockReset();
    submitContestSelectionMock.mockReset();
    updateContestEntryMock.mockReset();
  });

  const WEEK_1 = contestEventFixture({ sportEventId: 'event-1', sequence: 1, name: 'Week 1', startDate: '2099-09-06T17:00:00.000Z' });
  const WEEK_2 = contestEventFixture({ sportEventId: 'event-2', sequence: 2, name: 'Week 2', startDate: '2099-09-13T17:00:00.000Z' });

  /** The room for one event: its own field, each a complete one-pick lineup. */
  function eventRoom(sportEventId: string) {
    const golfer = sportEventId === 'event-2'
      ? buildGolfParticipant('sep-21', 'Xander Schauffele', 1, true)
      : buildGolfParticipant('sep-11', 'Scottie Scheffler', 1, true);
    return {
      ...buildSelectionState([{
        groupId: 'tier-1',
        groupName: 'Tier 1',
        groupNumber: 1,
        picksFromGroup: 1,
        selectedParticipantIds: [golfer.sportEventParticipantId],
        participants: [golfer],
      }]),
      sportEventId,
      entries: [{
        id: 'entry-1',
        userId: 'user-1',
        name: 'Birdie Hunters Entry 1',
        status: sportEventId === 'event-1' ? 'SUBMITTED' : 'DRAFT',
      }],
    };
  }

  function primeTwoEventMocks() {
    primeCommonMocks();
    getContestMock.mockResolvedValue({ data: { contest: contestFixture({ sportEvents: [WEEK_1, WEEK_2] }) } });
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 1,
        isJoined: true,
        myEntryId: 'entry-1',
        myEntryIds: ['entry-1'],
        entries: [{
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          squadName: 'Birdie Hunters',
          entryNumber: 1,
          name: 'Birdie Hunters Entry 1',
          events: [...entryEvents('SUBMITTED', 'event-1'), ...entryEvents('DRAFT', 'event-2')],
          tiebreakerValue: null,
          picksCount: 1,
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-16T00:00:00.000Z',
        }],
      },
    });
    // With no event named the server opens on the contest's next event, week 1.
    getSelectionStateMock.mockImplementation(({ query }: { query?: { sportEventId?: string } }) =>
      Promise.resolve({ data: eventRoom(query?.sportEventId ?? 'event-1') }));
  }

  it('offers an event switcher naming each event with the entry\'s status in it, opened on the event the server shows', async () => {
    primeTwoEventMocks();

    renderContestEntryPage();

    const switcher = await screen.findByTestId('contest-entry-event-switcher');
    expect(switcher).toHaveValue('event-1');
    const options = within(switcher).getAllByRole('option').map((option) => option.textContent);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatch(/^Week 1 · .+ · Submitted$/);
    expect(options[1]).toMatch(/^Week 2 · .+ · Not submitted$/);
    expect(screen.getByText('Scottie Scheffler')).toBeInTheDocument();
  });

  it('shows no event switcher for a contest of one event', async () => {
    primeCommonMocks();
    getSelectionStateMock.mockResolvedValue({ data: buildSelectionState([]) });

    renderContestEntryPage();

    await screen.findByTestId('contest-entry-heading');
    expect(screen.queryByTestId('contest-entry-event-switcher')).not.toBeInTheDocument();
  });

  it('reads the other event\'s picks when the switcher moves to it, asking for that event by id', async () => {
    primeTwoEventMocks();

    renderContestEntryPage();

    fireEvent.change(await screen.findByTestId('contest-entry-event-switcher'), { target: { value: 'event-2' } });

    await waitFor(() => expect(getSelectionStateMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { contestId: 'contest-1' },
      query: { entryId: 'entry-1', sportEventId: 'event-2' },
    })));
    expect(await screen.findByText('Xander Schauffele')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-event-switcher')).toHaveValue('event-2');
    expect(screen.getByTestId('contest-entry-status-badge')).toHaveTextContent('Not submitted');
  });

  it('submits the shown event\'s picks through that event\'s submit, not the first event\'s', async () => {
    primeTwoEventMocks();
    updateContestEntryMock.mockResolvedValue({ data: { entry: { id: 'entry-1' } } });
    submitContestEntryMock.mockResolvedValue({ data: { ...eventRoom('event-2'), entries: [{ id: 'entry-1', userId: 'user-1', name: 'Birdie Hunters Entry 1', status: 'SUBMITTED' }] } });

    renderContestEntryPage();

    fireEvent.change(await screen.findByTestId('contest-entry-event-switcher'), { target: { value: 'event-2' } });
    expect(await screen.findByText('Xander Schauffele')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contest-entry-tiebreaker-select'), { target: { value: '-12' } });
    fireEvent.click(screen.getByTestId('contest-entry-submit'));

    await waitFor(() => expect(submitContestEntryMock).toHaveBeenCalledWith({
      path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'event-2' },
    }));
    expect(submitContestEntryMock).toHaveBeenCalledTimes(1);
  });
});
