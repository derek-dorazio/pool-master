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
    sport: 'NFL',
    leagueName: 'Premier League',
    status: 'ACTIVE',
    entryCount: 12,
    startsAt: '2026-04-10T18:00:00.000Z',
  },
  {
    id: 'c2',
    name: 'March Madness',
    sport: 'NCAA_BASKETBALL',
    leagueName: 'Hoops Club',
    status: 'OPEN',
    entryCount: 8,
    startsAt: '2026-04-12T18:00:00.000Z',
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

  it('renders status and entry information', () => {
    renderWithRouter();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/12 entries/i)).toBeInTheDocument();
    expect(screen.getByText(/8 entries/i)).toBeInTheDocument();
  });

  it('renders sport icons using the shared sport enum labels', () => {
    renderWithRouter();
    expect(screen.getByLabelText('NFL')).toBeInTheDocument();
    expect(screen.getByLabelText('NCAA_BASKETBALL')).toBeInTheDocument();
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

  it('links each contest to its detail page', () => {
    renderWithRouter();
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/contests/c1')).toBe(true);
    expect(links.some((l) => l.getAttribute('href') === '/contests/c2')).toBe(true);
  });
});
