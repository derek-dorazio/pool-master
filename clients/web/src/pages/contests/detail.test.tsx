import type { ContestDetailView } from '@/features/contests/hooks/use-contest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestDetailPage } from './detail';

const mockActiveContest = {
  contest: {
    id: 'contest-1',
    name: 'Masters 2026 Pool',
    status: 'ACTIVE',
    contestType: 'SINGLE_EVENT',
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
    contestType: 'SINGLE_EVENT',
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

const mockContestEntries = {
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

const mockMyContestEntry = {
  contestId: 'contest-1',
  entry: mockContestEntries.entries[0],
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
const mutateAsync = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
    useMutation: () => ({ mutateAsync, isPending: false }),
    useQuery: (options: { queryKey: string[] }) => {
      const key = options.queryKey[2];
      if (key === 'standings-summary') {
        return { data: mockStandingsSummary, isLoading: false, isError: false };
      }
      if (key === 'my-standings-entry') {
        return { data: mockStandingsEntry, isLoading: false, isError: false };
      }
      if (key === 'entries') {
        return { data: mockContestEntries, isLoading: false, isError: false };
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
