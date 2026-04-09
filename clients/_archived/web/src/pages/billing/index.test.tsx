import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as BillingPage } from './index';

vi.mock('@/features/billing/hooks/use-billing', () => ({
  useBillingEnabled: () => ({ data: false, isLoading: false }),
  useBillingPlan: () => ({
    data: { tier: 'free', name: 'Free' },
    isLoading: false,
  }),
  useBillingUsage: () => ({
    data: {
      leagues: { current: 3, limit: 10 },
      contests: { current: 5, limit: 20 },
      members: { current: 12, limit: 50 },
    },
    isLoading: false,
  }),
  useBillingSubscription: () => ({ data: null }),
}));

vi.mock('@/features/billing/usage-meter', () => ({
  UsageMeter: ({ label }: { label: string }) => (
    <div data-testid={`usage-meter-${label.toLowerCase()}`}>{label}</div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <BillingPage />
    </MemoryRouter>,
  );
}

describe('BillingPage', () => {
  it('renders the current plan card', () => {
    renderPage();
    expect(screen.getByText('Current Plan')).toBeInTheDocument();
    expect(screen.getByText(/Free Plan/)).toBeInTheDocument();
  });

  it('renders usage meters', () => {
    renderPage();
    expect(screen.getByTestId('usage-meter-leagues')).toBeInTheDocument();
    expect(screen.getByTestId('usage-meter-contests')).toBeInTheDocument();
    expect(screen.getByTestId('usage-meter-members')).toBeInTheDocument();
  });

  it('shows disabled banner when billing is off', () => {
    renderPage();
    expect(
      screen.getByText('Ultimate Pool Manager is currently free for all users.'),
    ).toBeInTheDocument();
  });

  it('shows "Upgrade" link when on free plan', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeInTheDocument();
  });
});
