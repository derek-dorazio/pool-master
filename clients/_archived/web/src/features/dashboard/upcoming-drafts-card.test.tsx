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
    type: 'Snake Draft',
    scheduledAt: futureDate,
  },
  {
    id: 'd2',
    name: 'Masters Snake',
    leagueName: 'Hoops Club',
    type: 'Snake Draft',
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
    expect(screen.getByText('Masters Snake')).toBeInTheDocument();
  });

  it('renders draft type badges', () => {
    renderWithRouter();
    expect(screen.getAllByText('Snake Draft').length).toBeGreaterThan(0);
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

  it('disables Enter Draft Room button when draft is more than 5 minutes away', () => {
    renderWithRouter();
    const buttons = screen.getAllByRole('button', { name: /Enter Draft Room/i });
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('enables Enter Draft Room button when draft is within 5 minutes', () => {
    const soonDate = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min from now
    vi.mocked(useUpcomingDrafts).mockReturnValue({
      data: [{ id: 'd3', name: 'Soon Draft', leagueName: 'Quick League', type: 'Snake Draft', scheduledAt: soonDate }],
      isLoading: false,
    } as any);
    renderWithRouter();
    const link = screen.getByRole('link', { name: /Enter Draft Room/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/drafts/d3');
  });

  it('shows schedule pending when the contest has no start time yet', () => {
    vi.mocked(useUpcomingDrafts).mockReturnValue({
      data: [{ id: 'd4', name: 'Pending Draft', leagueName: 'Future League', type: 'Snake Draft', scheduledAt: null }],
      isLoading: false,
    } as any);
    renderWithRouter();

    expect(screen.getByText('Schedule pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enter Draft Room/i })).toBeDisabled();
  });
});
