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

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({
      data: {
        members: [
          { id: 'm1', name: 'Mike Johnson', initials: 'MJ', role: 'commissioner', joinDate: 'Aug 15, 2025', email: 'mike@example.com' },
          { id: 'm2', name: 'Sarah Kim', initials: 'SK', role: 'co-commissioner', joinDate: 'Aug 16, 2025', email: 'sarah@example.com' },
          { id: 'm3', name: 'Dan Miller', initials: 'DM', role: 'member', joinDate: 'Aug 20, 2025', email: 'dan@example.com' },
        ],
        pendingInvites: [],
      },
      isLoading: false,
      error: null,
    }),
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
