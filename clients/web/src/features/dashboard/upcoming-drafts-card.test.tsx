import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UpcomingDraftsCard } from './upcoming-drafts-card';

vi.mock('./hooks/use-upcoming-drafts', () => ({
  useUpcomingDrafts: vi.fn(() => ({ data: [], isLoading: false })),
}));

import { useUpcomingDrafts } from './hooks/use-upcoming-drafts';

const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now

const mockDrafts = [
  {
    id: 'd1',
    name: 'NFL Week 5 Draft',
    leagueName: 'Fantasy Pros',
    type: 'Snake',
    scheduledAt: futureDate,
  },
  {
    id: 'd2',
    name: 'NBA Auction',
    leagueName: 'Hoops Club',
    type: 'Auction',
    scheduledAt: futureDate,
  },
];

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <UpcomingDraftsCard />
    </MemoryRouter>,
  );
}

describe('UpcomingDraftsCard', () => {
  beforeEach(() => {
    vi.mocked(useUpcomingDrafts).mockReturnValue({ data: mockDrafts, isLoading: false } as any);
  });

  it('renders draft names', () => {
    renderWithRouter();
    expect(screen.getByText('NFL Week 5 Draft')).toBeInTheDocument();
    expect(screen.getByText('NBA Auction')).toBeInTheDocument();
  });

  it('renders draft type badges', () => {
    renderWithRouter();
    expect(screen.getByText('Snake')).toBeInTheDocument();
    expect(screen.getByText('Auction')).toBeInTheDocument();
  });

  it('renders league names', () => {
    renderWithRouter();
    expect(screen.getByText('Fantasy Pros')).toBeInTheDocument();
    expect(screen.getByText('Hoops Club')).toBeInTheDocument();
  });

  it('shows empty state when no drafts', () => {
    vi.mocked(useUpcomingDrafts).mockReturnValue({ data: [], isLoading: false } as any);
    renderWithRouter();
    expect(screen.getByText('No upcoming drafts.')).toBeInTheDocument();
  });

  it('shows loading text when isLoading is true', () => {
    vi.mocked(useUpcomingDrafts).mockReturnValue({ data: undefined, isLoading: true } as any);
    renderWithRouter();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
