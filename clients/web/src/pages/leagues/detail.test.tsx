import { render, screen } from '@testing-library/react';
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

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({
      data: {
        ...mockLeague,
        name: 'Masters Pool',
        memberCount: 8,
        commissioner: 'Mike Johnson',
        isCommissioner: true,
        description: 'A competitive pool league.',
        contests: [
          {
            id: 'contest-1',
            name: 'Week 14 Pick\'em',
            status: 'active',
            standings: [
              { name: 'Sarah K.', points: 87 },
              { name: 'Dan M.', points: 82 },
            ],
          },
          {
            id: 'contest-2',
            name: 'Survivor Pool 2025',
            status: 'active',
            standings: [
              { name: 'You', points: 12 },
              { name: 'Chris P.', points: 12 },
            ],
          },
        ],
        members: [
          { id: 'm1', name: 'Mike Johnson', role: 'commissioner' },
          { id: 'm2', name: 'Sarah Kim', role: 'member' },
        ],
        feedItems: [
          {
            id: 'f1',
            type: 'event',
            author: 'System',
            content: 'Week 14 is now live',
            timestamp: '2 hours ago',
          },
        ],
        nextDraft: null,
      },
      isLoading: false,
      error: null,
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

  it('shows settings link for owners (commissioner)', () => {
    renderPage();
    const settingsLink = screen.getByRole('link', { name: /Settings/ });
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink).toHaveAttribute('href', '/leagues/league-1/settings');
  });
});
