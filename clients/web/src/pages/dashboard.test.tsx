import { render, screen } from '@testing-library/react';
import { Component as DashboardPage } from './dashboard';

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: any) =>
    selector({ user: { displayName: 'Derek' }, isAuthenticated: true }),
}));

vi.mock('@/features/dashboard/quick-actions-bar', () => ({
  QuickActionsBar: () => <div data-testid="quick-actions-bar" />,
}));

vi.mock('@/features/dashboard/active-contests-card', () => ({
  ActiveContestsCard: () => <div data-testid="active-contests-card" />,
}));

vi.mock('@/features/dashboard/upcoming-drafts-card', () => ({
  UpcomingDraftsCard: () => <div data-testid="upcoming-drafts-card" />,
}));

vi.mock('@/features/dashboard/my-leagues-summary', () => ({
  MyLeaguesSummary: () => <div data-testid="my-leagues-summary" />,
}));

vi.mock('@/features/dashboard/recent-activity-feed', () => ({
  RecentActivityFeed: () => <div data-testid="recent-activity-feed" />,
}));

vi.mock('@/features/dashboard/season-highlights-card', () => ({
  SeasonHighlightsCard: () => <div data-testid="season-highlights-card" />,
}));

describe('DashboardPage', () => {
  it('renders welcome message with user name', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Welcome back, Derek')).toBeInTheDocument();
  });

  it('shows quick actions bar', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('quick-actions-bar')).toBeInTheDocument();
  });

  it('renders active contests section', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('active-contests-card')).toBeInTheDocument();
  });

  it('renders leagues section', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('my-leagues-summary')).toBeInTheDocument();
  });

  it('renders activity section', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('recent-activity-feed')).toBeInTheDocument();
  });
});
