import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestDetailPage } from './detail';

const mockContest = {
  name: 'Masters 2026 Pool',
  status: 'In Progress',
  sport: 'Golf',
  sportEmoji: '⛳',
  eventName: 'The Masters 2026',
  leagueId: 'league-1',
  leagueName: 'Sunday Picks',
  totalEntries: 12,
  contestType: 'Snake Draft',
  scoringType: 'Stroke Play',
  draftType: 'Live',
  entryDeadline: '2026-04-08T00:00:00Z',
  createdBy: 'Derek',
  myEntry: {
    rank: 3,
    score: 42.5,
    participants: [
      { id: 'p1', name: 'Scottie Scheffler', position: 'T2', score: 18.5 },
      { id: 'p2', name: 'Rory McIlroy', position: 'T5', score: 12.0 },
    ],
  },
  topEntries: [
    { id: 'e1', rank: 1, movement: 'up' as const, entryName: 'Team Alpha', ownerName: 'Alice', score: 55, isCurrentUser: false },
    { id: 'e2', rank: 2, movement: 'none' as const, entryName: 'Team Beta', ownerName: 'Bob', score: 50, isCurrentUser: false },
    { id: 'e3', rank: 3, movement: 'down' as const, entryName: "Derek's Picks", ownerName: 'Derek', score: 42.5, isCurrentUser: true },
  ],
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ contestId: 'c-123' }) };
});

vi.mock('@/features/contests/hooks/use-contest', () => ({
  useContest: () => ({ data: mockContest, isLoading: false }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ContestDetailPage />
    </MemoryRouter>,
  );
}

describe('ContestDetailPage', () => {
  it('renders contest name', () => {
    renderPage();
    expect(screen.getByText('Masters 2026 Pool')).toBeInTheDocument();
  });

  it('shows status badge', () => {
    renderPage();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders standings snapshot', () => {
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
});
