import { render, screen } from '@testing-library/react';
import { EntitlementGate } from './entitlement-gate';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';

describe('EntitlementGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when user is entitled', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: { entitled: true },
      isLoading: false,
    } as any);
    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Gated Content</p>
      </EntitlementGate>,
    );
    expect(screen.getByText('Gated Content')).toBeInTheDocument();
  });

  it('shows upgrade prompt with "Plan Limit Reached" when not entitled', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: { entitled: false, reason: 'You have reached the league limit.', upgradePlan: 'pro' },
      isLoading: false,
    } as any);
    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Gated Content</p>
      </EntitlementGate>,
    );
    expect(screen.queryByText('Gated Content')).not.toBeInTheDocument();
    expect(screen.getByText('Plan Limit Reached')).toBeInTheDocument();
    expect(screen.getByText(/league limit/)).toBeInTheDocument();
  });

  it('shows usage count when currentUsage and limit are provided', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: { entitled: false, currentUsage: 5, limit: 5, upgradePlan: 'pro' },
      isLoading: false,
    } as any);
    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Gated Content</p>
      </EntitlementGate>,
    );
    expect(screen.getByText(/5 \/ 5/)).toBeInTheDocument();
  });

  it('renders MVP deferment messaging when upgradePlan is provided', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: { entitled: false, upgradePlan: 'pro' },
      isLoading: false,
    } as any);
    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Gated Content</p>
      </EntitlementGate>,
    );
    expect(
      screen.getByText('Paid plan upgrades are deferred for the MVP launch.'),
    ).toBeInTheDocument();
  });

  it('renders children while loading (fail-open behavior)', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);
    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Gated Content</p>
      </EntitlementGate>,
    );
    expect(screen.getByText('Gated Content')).toBeInTheDocument();
  });
});
