import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanCard } from './plan-card';

const basePlan = {
  tier: 'pro' as const,
  name: 'Pro',
  price: 9.99,
  annualPrice: 107.88,
  features: {
    leagues: 10,
    membersPerLeague: 50,
    contestsPerLeague: null,
    draftTypes: 'All',
    scoringTemplates: 'All',
    customScoring: true,
    historyRetention: '5 years',
    supportLevel: 'Priority',
  },
};

describe('PlanCard', () => {
  it('renders plan name and price', () => {
    render(
      <PlanCard
        plan={basePlan}
        isCurrentPlan={false}
        isBillingEnabled={true}
        billingCycle="monthly"
      />,
    );
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('$9.99/mo')).toBeInTheDocument();
  });

  it('shows "Current" badge when plan is active', () => {
    render(
      <PlanCard
        plan={basePlan}
        isCurrentPlan={true}
        isBillingEnabled={true}
        billingCycle="monthly"
      />,
    );
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Current Plan/i })).toBeDisabled();
  });

  it('shows "Upgrade to Pro" CTA for non-current plan', () => {
    render(
      <PlanCard
        plan={basePlan}
        isCurrentPlan={false}
        isBillingEnabled={true}
        billingCycle="monthly"
      />,
    );
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeEnabled();
  });

  it('shows "Coming Soon" when billing is disabled', () => {
    render(
      <PlanCard
        plan={basePlan}
        isCurrentPlan={false}
        isBillingEnabled={false}
        billingCycle="monthly"
      />,
    );
    expect(screen.getByRole('button', { name: /Coming Soon/i })).toBeDisabled();
  });

  it('renders feature checklist rows', () => {
    render(
      <PlanCard
        plan={basePlan}
        isCurrentPlan={false}
        isBillingEnabled={true}
        billingCycle="monthly"
      />,
    );
    expect(screen.getByText('Leagues')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Members per league')).toBeInTheDocument();
    expect(screen.getByText('Unlimited')).toBeInTheDocument(); // contestsPerLeague is null
  });

  it('calls onSelect with tier when upgrade button is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={basePlan}
        isCurrentPlan={false}
        isBillingEnabled={true}
        billingCycle="monthly"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Upgrade to Pro/i }));
    expect(onSelect).toHaveBeenCalledWith('pro');
  });
});
