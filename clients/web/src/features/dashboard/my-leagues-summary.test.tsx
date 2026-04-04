import { render, screen } from '@testing-library/react';
import { MyLeaguesSummary } from './my-leagues-summary';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));

vi.mock('./hooks/use-my-leagues', () => ({
  useMyLeagues: vi.fn(),
}));

import { useMyLeagues } from './hooks/use-my-leagues';

function makeLeague(overrides: Partial<any> = {}) {
  return {
    id: 'lg-1',
    name: 'Weekend Warriors',
    role: 'Member',
    memberCount: 10,
    activeContestCount: 2,
    ...overrides,
  };
}

describe('MyLeaguesSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders league cards with names', () => {
    vi.mocked(useMyLeagues).mockReturnValue({
      data: [makeLeague(), makeLeague({ id: 'lg-2', name: 'Euro Squad' })],
      isLoading: false,
    } as any);
    render(<MyLeaguesSummary />);
    expect(screen.getByText('Weekend Warriors')).toBeInTheDocument();
    expect(screen.getByText('Euro Squad')).toBeInTheDocument();
  });

  it('shows commissioner badge (Crown icon) for commissioners', () => {
    vi.mocked(useMyLeagues).mockReturnValue({
      data: [makeLeague({ role: 'Commissioner' })],
      isLoading: false,
    } as any);
    const { container } = render(<MyLeaguesSummary />);
    // Crown icon renders as an SVG with the lucide class
    expect(container.querySelector('.text-yellow-500')).toBeInTheDocument();
  });

  it('displays member count for each league', () => {
    vi.mocked(useMyLeagues).mockReturnValue({
      data: [makeLeague({ memberCount: 15 })],
      isLoading: false,
    } as any);
    render(<MyLeaguesSummary />);
    expect(screen.getByText('15 members')).toBeInTheDocument();
  });

  it('shows "View all" link when there are more than 6 leagues', () => {
    const leagues = Array.from({ length: 8 }, (_, i) =>
      makeLeague({ id: `lg-${i}`, name: `League ${i}` }),
    );
    vi.mocked(useMyLeagues).mockReturnValue({ data: leagues, isLoading: false } as any);
    render(<MyLeaguesSummary />);
    expect(screen.getByText('View all')).toBeInTheDocument();
    // Only 6 should be displayed
    expect(screen.queryByText('League 7')).not.toBeInTheDocument();
  });

  it('shows empty state with CTA buttons when no leagues', () => {
    vi.mocked(useMyLeagues).mockReturnValue({ data: [], isLoading: false } as any);
    render(<MyLeaguesSummary />);
    expect(screen.getByText(/haven.*joined any leagues/i)).toBeInTheDocument();
    expect(screen.getByText('Create League')).toBeInTheDocument();
    expect(screen.getByText('Join League')).toBeInTheDocument();
  });

  it('does not show "View all" link when there are 6 or fewer leagues', () => {
    const leagues = Array.from({ length: 3 }, (_, i) =>
      makeLeague({ id: `lg-${i}`, name: `League ${i}` }),
    );
    vi.mocked(useMyLeagues).mockReturnValue({ data: leagues, isLoading: false } as any);
    render(<MyLeaguesSummary />);
    expect(screen.queryByText('View all')).not.toBeInTheDocument();
  });

  it('does not show "View all" link when there are exactly 6 leagues', () => {
    const leagues = Array.from({ length: 6 }, (_, i) =>
      makeLeague({ id: `lg-${i}`, name: `League ${i}` }),
    );
    vi.mocked(useMyLeagues).mockReturnValue({ data: leagues, isLoading: false } as any);
    render(<MyLeaguesSummary />);
    expect(screen.queryByText('View all')).not.toBeInTheDocument();
  });
});
