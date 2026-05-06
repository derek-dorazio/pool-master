import type { ContestDetailView } from '@/features/contests/hooks/use-contest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestDetailPage } from './detail';

const mockActiveContest = {
  contest: {
    id: 'contest-1',
    name: 'Masters 2026 Pool',
    status: 'ACTIVE',
    contestType: 'ROSTER',
    selectionType: 'SNAKE_DRAFT',
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    startsAt: '2026-04-08T00:00:00Z',
    endsAt: '2026-04-12T00:00:00Z',
    lockAt: '2026-04-08T12:00:00Z',
    sport: 'GOLF',
  },
  selectionConfig: null,
};

const mockDraftContest = {
  contest: {
    id: 'contest-1',
    name: 'Masters 2026 Pool',
    status: 'DRAFT',
    contestType: 'ROSTER',
    selectionType: 'SNAKE_DRAFT',
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    startsAt: '2026-04-08T00:00:00Z',
    endsAt: '2026-04-12T00:00:00Z',
    lockAt: '2026-04-08T12:00:00Z',
    sport: 'GOLF',
  },
  selectionConfig: { rounds: 6 },
};

const mockSummary = {
  topEntries: [
    { rank: 1, entryId: 'e1', entryName: 'Team Alpha', ownerDisplayName: 'Alice', ownerId: 'u1', totalScore: 55, previousRank: 2, movement: 'up' as const, isEliminated: false, lastUpdatedAt: '2026-04-08T00:00:00Z' },
    { rank: 2, entryId: 'e2', entryName: 'Team Beta', ownerDisplayName: 'Bob', ownerId: 'u2', totalScore: 50, previousRank: 1, movement: 'down' as const, isEliminated: false, lastUpdatedAt: '2026-04-08T00:00:00Z' },
  ],
  totalEntries: 12,
  contestId: 'contest-1',
};

const mockMyEntry = {
  entry: {
    rank: 3,
    entryId: 'e3',
    entryName: "Derek's Picks",
    ownerDisplayName: 'Derek',
    ownerId: 'u3',
    totalScore: 42.5,
    previousRank: 4,
    movement: 'up' as const,
    isEliminated: false,
    lastUpdatedAt: '2026-04-08T00:00:00Z',
  },
  totalEntries: 12,
  contestId: 'contest-1',
};

const baseContestEntries = {
  contestId: 'contest-1',
  total: 2,
  isJoined: true,
  myEntryId: 'entry-1',
  entries: [
    {
      id: 'entry-1',
      contestId: 'contest-1',
      leagueMembershipId: 'm-1',
      name: "Derek's Entry",
      totalScore: 0,
      rank: null,
      isEliminated: false,
      ownerId: 'u3',
      ownerDisplayName: 'Derek',
      createdAt: '2026-04-07T00:00:00Z',
      updatedAt: '2026-04-07T00:00:00Z',
    },
  ],
};

let contestEntries = { ...baseContestEntries };
const mockMyContestEntry = {
  contestId: 'contest-1',
  entry: baseContestEntries.entries[0],
};

let contestState: ContestDetailView = mockActiveContest;
let mockStandingsSummary: typeof mockSummary | undefined = mockSummary;
let mockStandingsEntry: typeof mockMyEntry | undefined = mockMyEntry;
let mockJoinedContestEntry: typeof mockMyContestEntry | undefined = mockMyContestEntry;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ contestId: 'contest-1' }) };
});

vi.mock('@/features/contests/hooks/use-contest', () => ({
  useContest: () => ({ data: contestState, isLoading: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { displayName: string } | null }) => unknown) =>
    selector({ user: { displayName: 'Derek' } }),
}));

const invalidateQueries = vi.fn();
const mutationCalls = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
    useMutation: (options: { onSuccess?: () => Promise<void> | void }) => ({
      mutateAsync: vi.fn(async () => {
        mutationCalls();
        await options.onSuccess?.();
      }),
      isPending: false,
    }),
    useQuery: (options: { queryKey: string[] }) => {
      const key = options.queryKey[2];
      if (key === 'standings-summary') {
        return { data: mockStandingsSummary, isLoading: false, isError: false };
      }
      if (key === 'my-standings-entry') {
        return { data: mockStandingsEntry, isLoading: false, isError: false };
      }
      if (key === 'entries') {
        return { data: contestEntries, isLoading: false, isError: false };
      }
      if (key === 'my-entry') {
        return { data: mockJoinedContestEntry, isLoading: false, isError: false };
      }
      return { data: undefined, isLoading: false, isError: false };
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ContestDetailPage />
    </MemoryRouter>,
  );
}

describe('ContestDetailPage', () => {
  beforeEach(() => {
    contestState = mockActiveContest;
    mockStandingsSummary = mockSummary;
    mockStandingsEntry = mockMyEntry;
    mockJoinedContestEntry = mockMyContestEntry;
    contestEntries = { ...baseContestEntries };
    mutationCalls.mockClear();
    invalidateQueries.mockClear();
  });

  it('renders contest name', () => {
    renderPage();
    expect(screen.getByText('Masters 2026 Pool')).toBeInTheDocument();
  });

  it('shows normalized status badge', () => {
    renderPage();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders standings snapshot from real summary data', () => {
    renderPage();
    expect(screen.getByText('Standings Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('Team Beta')).toBeInTheDocument();
  });

  it('uses singular contest count labels for a single active entry', () => {
    contestState = {
      contest: {
        ...mockActiveContest.contest,
        name: "NFL Weekly Pick'em",
        selectionType: 'PICK_EM',
      },
      selectionConfig: null,
    };
    mockStandingsSummary = {
      ...mockSummary,
      topEntries: [mockSummary.topEntries[0]],
      totalEntries: 1,
    };

    renderPage();

    expect(screen.getByText(/1 prediction/i)).toBeInTheDocument();
  });

  it('shows action buttons', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /View Scoring/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Full Standings/ })).toBeInTheDocument();
  });

  it('renders the live pre-draft contest entry flow for draft contests', () => {
    contestState = mockDraftContest;
    renderPage();

    expect(screen.getByText("You're entered!")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Draft Room/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave Contest/ })).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/i)).toBeInTheDocument();
  });

  it('invites the user into a draft contest and refreshes contest queries after joining', async () => {
    const user = userEvent.setup();
    contestState = mockDraftContest;
    contestEntries = { ...baseContestEntries, isJoined: false };
    mockJoinedContestEntry = undefined;

    renderPage();

    await user.click(screen.getByRole('button', { name: /Enter Contest/ }));

    await waitFor(() => {
      expect(mutationCalls).toHaveBeenCalled();
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contests', 'contest-1', 'entries'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contests', 'contest-1', 'my-entry'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contests', 'contest-1'] });
  });

  it('removes the user from a joined draft contest and refreshes contest queries after leaving', async () => {
    const user = userEvent.setup();
    contestState = mockDraftContest;
    contestEntries = { ...baseContestEntries, isJoined: true };
    mockJoinedContestEntry = mockMyContestEntry;

    renderPage();

    await user.click(screen.getByRole('button', { name: /Leave Contest/ }));

    await waitFor(() => {
      expect(mutationCalls).toHaveBeenCalled();
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contests', 'contest-1', 'entries'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contests', 'contest-1', 'my-entry'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['contests', 'contest-1'] });
  });

  it('uses mode-aware room labels for non-snake contests', () => {
    contestState = {
      contest: {
        ...mockDraftContest.contest,
        selectionType: 'PICK_EM',
      },
      selectionConfig: { picksPerPeriod: 3 },
    };

    renderPage();

    expect(screen.getByRole('link', { name: /Open Pick'em Room/ })).toBeInTheDocument();
  });

  it("uses mode-aware labels for active pick'em contests", () => {
    contestState = {
      contest: {
        ...mockActiveContest.contest,
        name: "NFL Weekly Pick'em",
        selectionType: 'PICK_EM',
      },
      selectionConfig: null,
    };

    renderPage();

    expect(screen.getByText("My Pick'em Entry")).toBeInTheDocument();
    expect(screen.getByText("Pick'em Standings Snapshot")).toBeInTheDocument();
    expect(screen.getAllByText('Prediction Score').length).toBeGreaterThan(0);
    expect(screen.getByText('Prediction')).toBeInTheDocument();
    expect(screen.getByText(/view full pick'em standings/i)).toBeInTheDocument();
    expect(screen.getAllByText("Pick'em").length).toBeGreaterThan(0);
    expect(screen.getByText(/12 predictions/i)).toBeInTheDocument();
    expect(screen.getByText('Single Event')).toBeInTheDocument();
    expect(screen.getByText('Stroke Play')).toBeInTheDocument();
  });

  it("uses mode-aware labels for active bracket pick'em contests", () => {
    contestState = {
      contest: {
        ...mockActiveContest.contest,
        name: "March Madness Bracket",
        selectionType: 'BRACKET_PICK_EM',
      },
      selectionConfig: null,
    };

    renderPage();

    expect(screen.getByText("My Bracket Entry")).toBeInTheDocument();
    expect(screen.getByText("Bracket Standings Snapshot")).toBeInTheDocument();
    expect(screen.getAllByText('Bracket Score').length).toBeGreaterThan(0);
    expect(screen.getByText('Bracket')).toBeInTheDocument();
    expect(screen.getByText(/view full bracket standings/i)).toBeInTheDocument();
  });

  it('shows the real contest entry when standings are not available yet', () => {
    mockStandingsSummary = undefined;
    mockStandingsEntry = undefined;

    renderPage();

    expect(screen.getAllByText('My Entry').length).toBeGreaterThan(0);
    expect(screen.getByText("Derek's Entry")).toBeInTheDocument();
    expect(screen.getByText(/standings have not been generated/i)).toBeInTheDocument();
  });

  it('shows contestant setup details from the real selection config', () => {
    contestState = {
      contest: {
        ...mockActiveContest.contest,
        selectionType: 'TIERED',
      },
      selectionConfig: {
        rosterSize: 6,
        tierAssignmentMethod: 'ODDS',
        tierCount: 6,
        picksPerTier: 1,
      },
    };

    renderPage();

    expect(screen.getByText('Tier Assignment')).toBeInTheDocument();
    expect(screen.getByText('Odds')).toBeInTheDocument();
    expect(screen.getByText('Tier Count')).toBeInTheDocument();
    expect(screen.getByText('Picks Per Tier')).toBeInTheDocument();
  });
});
