import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActiveContestsCard } from './active-contests-card';

vi.mock('./hooks/use-active-contests', () => ({
  useActiveContests: vi.fn(() => ({ data: [], isLoading: false })),
}));

import { useActiveContests } from './hooks/use-active-contests';

const mockContests = [
  {
    id: 'c1',
    name: 'Sunday Showdown',
    sport: 'football',
    leagueName: 'Premier League',
    rank: 3,
    totalEntrants: 12,
    score: 142,
    delta: 2,
  },
  {
    id: 'c2',
    name: 'March Madness',
    sport: 'basketball',
    leagueName: 'Hoops Club',
    rank: 1,
    totalEntrants: 8,
    score: 88,
    delta: 0,
  },
];

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <ActiveContestsCard />
    </MemoryRouter>,
  );
}

describe('ActiveContestsCard', () => {
  beforeEach(() => {
    vi.mocked(useActiveContests).mockReturnValue({ data: mockContests, isLoading: false } as any);
  });

  it('renders contest names', () => {
    renderWithRouter();
    expect(screen.getByText('Sunday Showdown')).toBeInTheDocument();
    expect(screen.getByText('March Madness')).toBeInTheDocument();
  });

  it('renders rank and score information', () => {
    renderWithRouter();
    expect(screen.getByText('3rd of 12')).toBeInTheDocument();
    expect(screen.getByText('142 pts')).toBeInTheDocument();
    expect(screen.getByText('1st of 8')).toBeInTheDocument();
    expect(screen.getByText('88 pts')).toBeInTheDocument();
  });

  it('shows empty state when data is empty array', () => {
    vi.mocked(useActiveContests).mockReturnValue({ data: [], isLoading: false } as any);
    renderWithRouter();
    expect(screen.getByText('No active contests')).toBeInTheDocument();
    expect(screen.getByText('Discover contests')).toBeInTheDocument();
  });

  it('shows loading text when isLoading is true', () => {
    vi.mocked(useActiveContests).mockReturnValue({ data: undefined, isLoading: true } as any);
    renderWithRouter();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows positive delta indicator for contests with delta > 0', () => {
    renderWithRouter();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('links each contest to its detail page', () => {
    renderWithRouter();
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/contests/c1')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/contests/c2')).toBe(true);
  });
});
