import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as LeagueDetailPage } from './detail';

const mockLeague = {
  id: 'league-1',
  name: 'Masters Pool',
  visibility: 'PRIVATE',
  memberCount: 8,
  activeContestCount: 2,
  role: 'OWNER',
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'league-1' }),
  };
});

const mockContests = [
  {
    id: 'contest-1',
    name: 'Week 14 Pick\'em',
    status: 'active',
  },
  {
    id: 'contest-2',
    name: 'Survivor Pool 2025',
    status: 'active',
  },
];

const mockMembers = [
  { id: 'm1', userId: 'u1', displayName: 'Mike Johnson', role: 'OWNER' },
  { id: 'm2', userId: 'u2', displayName: 'Sarah Kim', role: 'MANAGER' },
];

const mockResults = [
  {
    id: 'result-1',
    contestName: 'Masters Pick 6',
    contestType: 'TIERED',
    sport: 'GOLF',
    finalRank: 1,
    totalScore: 128,
    prizeLabel: 'Champion',
    isWinner: true,
    closedAt: '2026-04-03T18:00:00.000Z',
  },
  {
    id: 'result-2',
    contestName: 'Masters Pick 6',
    contestType: 'TIERED',
    sport: 'GOLF',
    finalRank: 4,
    totalScore: 112,
    isWinner: false,
    closedAt: '2026-04-03T18:00:00.000Z',
  },
];

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => {
      const key = options.queryKey[0];
      if (key === 'league-contests') {
        return { data: mockContests, isLoading: false, isError: false, error: null };
      }
      if (key === 'league-members') {
        return { data: mockMembers, isLoading: false, isError: false, error: null };
      }
      if (key === 'league-results') {
        return { data: mockResults, isLoading: false, isError: false, error: null };
      }
      // Default: league detail
      return {
        data: {
          ...mockLeague,
          name: 'Masters Pool',
          memberCount: 8,
          role: 'OWNER',
          description: 'A competitive pool league.',
        },
        isLoading: false,
        isError: false,
        error: null,
      };
    },
    useMutation: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LeagueDetailPage />
    </MemoryRouter>,
  );
}

describe('LeagueDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders league name', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Masters Pool' })).toBeInTheDocument();
  });

  it('renders member count', () => {
    renderPage();
    expect(screen.getByText(/8 members/)).toBeInTheDocument();
  });

  it('renders contests section', () => {
    renderPage();
    expect(screen.getByText('Active Contests')).toBeInTheDocument();
    expect(screen.getByText("Week 14 Pick'em")).toBeInTheDocument();
    expect(screen.getByText('Survivor Pool 2025')).toBeInTheDocument();
  });

  it('shows settings link for owners', () => {
    renderPage();
    const settingsLink = screen.getByRole('link', { name: /Settings/ });
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink).toHaveAttribute('href', '/leagues/league-1/settings');
  });

  it('renders finished contests in the history tab', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.getByText('Finished Contests')).toBeInTheDocument();
    expect(screen.getAllByText('Masters Pick 6')).toHaveLength(2);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('128 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open full history/ })).toHaveAttribute(
      'href',
      '/leagues/league-1/history',
    );
  });
});
