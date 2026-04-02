import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as LeagueMembersPage } from './members';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'league-1' }),
  };
});

const mockMembers = [
  { id: 'm1', userId: 'u1', displayName: 'Mike Johnson', role: 'commissioner', joinedAt: '2025-08-15T00:00:00Z' },
  { id: 'm2', userId: 'u2', displayName: 'Sarah Kim', role: 'co-commissioner', joinedAt: '2025-08-16T00:00:00Z' },
  { id: 'm3', userId: 'u3', displayName: 'Dan Miller', role: 'member', joinedAt: '2025-08-20T00:00:00Z' },
];

const mockLeague = {
  id: 'league-1',
  name: 'Test League',
  memberCount: 3,
  activeContestCount: 0,
  visibility: 'PRIVATE',
  role: 'commissioner',
};

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => {
      const key = options.queryKey[0];
      if (key === 'league-members') {
        return { data: mockMembers, isLoading: false, isError: false, error: null };
      }
      if (key === 'league') {
        return { data: mockLeague, isLoading: false, isError: false, error: null };
      }
      if (key === 'league-invite-link') {
        return { data: 'https://poolmaster.app/join/abc123xyz', isLoading: false, isError: false, error: null };
      }
      return { data: undefined, isLoading: false, isError: false, error: null };
    },
  };
});

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <LeagueMembersPage />
    </MemoryRouter>,
  );
}

describe('LeagueMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders member list', () => {
    renderPage();
    expect(screen.getByText('Mike Johnson')).toBeInTheDocument();
    expect(screen.getByText('Sarah Kim')).toBeInTheDocument();
    expect(screen.getByText('Dan Miller')).toBeInTheDocument();
    expect(screen.getByText('3 members in this league')).toBeInTheDocument();
  });

  it('shows role badge for each member', () => {
    renderPage();
    expect(screen.getByText('Commissioner')).toBeInTheDocument();
    expect(screen.getByText('Co-Commissioner')).toBeInTheDocument();
    // "Member" appears both as a table header and as a role badge; use getAllByText
    const memberTexts = screen.getAllByText('Member');
    expect(memberTexts.length).toBeGreaterThanOrEqual(2); // header + badge
  });

  it('shows invite button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Invite Member/ })).toBeInTheDocument();
  });
});
