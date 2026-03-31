import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestDetailPage } from './detail';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ contestId: 'contest-789' }),
  };
});

const mockContest = {
  id: 'contest-789',
  name: 'Masters 2026 Pool',
  tenant: 'Acme Corp',
  league: 'Sunday Picks',
  sport: 'Golf',
  sportEmoji: '⛳',
  type: 'Single Event',
  selectionType: 'Snake Draft',
  status: 'ACTIVE',
  lastStatEvent: '2 minutes ago',
  statEventsProcessed: 1250,
  corrections: 3,
  standings: [
    { rank: 1, entryName: 'Team Alpha', ownerEmail: 'alpha@example.com', totalScore: 287.5 },
    { rank: 2, entryName: 'Team Bravo', ownerEmail: 'bravo@example.com', totalScore: 275.0 },
  ],
  draftStatus: {
    status: 'Completed',
    currentPick: 48,
    totalPicks: 48,
    started: '2025-04-01T18:00:00Z',
  },
  picks: [
    { round: 1, pick: 1, participant: 'Scottie Scheffler', owner: 'alpha@example.com', autoPicked: false, time: '45s' },
  ],
  overrides: [
    { admin: 'admin@poolmaster.io', entry: 'Team Alpha', oldScore: 280, newScore: 287.5, reason: 'Correction applied', date: '2025-04-05' },
  ],
};

vi.mock('@/hooks/use-contests-api', () => ({
  useContestDetail: () => ({
    data: mockContest,
    isLoading: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  adminApi: { post: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ContestDetailPage />
    </MemoryRouter>,
  );
}

describe('ContestDetailPage', () => {
  it('renders contest name in the header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Masters 2026 Pool' })).toBeInTheDocument();
  });

  it('shows tabs for Standings, Scoring Data, Draft, Overrides, and Admin Actions', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Standings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scoring Data' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Draft' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overrides' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Admin Actions' })).toBeInTheDocument();
  });

  it('shows sport badge with emoji', () => {
    renderPage();
    // The badge text combines emoji and sport name
    expect(screen.getByText(/Golf/)).toBeInTheDocument();
  });

  it('shows the admin actions section with action cards', async () => {
    const user = userEvent.setup();
    renderPage();
    const actionsTab = screen.getByRole('tab', { name: 'Admin Actions' });
    await user.click(actionsTab);
    expect(screen.getByText('Force Close Contest')).toBeInTheDocument();
    expect(screen.getByText('Reopen Contest')).toBeInTheDocument();
    expect(screen.getByText('Recalculate Standings')).toBeInTheDocument();
  });

  it('shows the ACTIVE status badge', () => {
    renderPage();
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThanOrEqual(1);
  });
});
