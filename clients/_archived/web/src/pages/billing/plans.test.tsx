import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as PlansPage } from './plans';

const mockPlans = [
  { tier: 'free', name: 'Free', price: { monthly: 0, annual: 0 }, features: [] },
  { tier: 'starter', name: 'Starter', price: { monthly: 9.99, annual: 99 }, features: [] },
  { tier: 'pro', name: 'Pro', price: { monthly: 19.99, annual: 199 }, features: [] },
  { tier: 'league-plus', name: 'League+', price: { monthly: 39.99, annual: 399 }, features: [] },
];

vi.mock('@/features/billing/hooks/use-billing', () => ({
  useBillingEnabled: () => ({ data: true }),
  useBillingPlan: () => ({
    data: { tier: 'free', name: 'Free' },
    isLoading: false,
  }),
  usePlanTiers: () => ({
    data: mockPlans,
    isLoading: false,
  }),
}));

vi.mock('@/features/billing/plan-card', () => ({
  PlanCard: ({ plan, isCurrentPlan }: { plan: { name: string }; isCurrentPlan: boolean }) => (
    <div data-testid={`plan-card-${plan.name}`}>
      {plan.name}
      {isCurrentPlan && <span>Current Plan</span>}
    </div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PlansPage />
    </MemoryRouter>,
  );
}

describe('PlansPage', () => {
  it('renders 4 plan cards', () => {
    renderPage();
    expect(screen.getByTestId('plan-card-Free')).toBeInTheDocument();
    expect(screen.getByTestId('plan-card-Starter')).toBeInTheDocument();
    expect(screen.getByTestId('plan-card-Pro')).toBeInTheDocument();
    expect(screen.getByTestId('plan-card-League+')).toBeInTheDocument();
  });

  it('renders billing cycle toggle with Monthly and Annual buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Monthly/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annual/ })).toBeInTheDocument();
  });

  it('renders FAQ section', () => {
    renderPage();
    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument();
    expect(screen.getByText('What happens when I upgrade?')).toBeInTheDocument();
    expect(screen.getByText('Can I cancel anytime?')).toBeInTheDocument();
  });

  it('shows "Current Plan" badge on the active plan', () => {
    renderPage();
    const freePlan = screen.getByTestId('plan-card-Free');
    expect(freePlan).toHaveTextContent('Current Plan');
  });
});
