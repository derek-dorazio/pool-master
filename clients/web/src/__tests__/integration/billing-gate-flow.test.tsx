import { render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';
import { EntitlementGate } from '@/features/leagues/entitlement-gate';

describe('Billing Entitlement Gate Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when API returns entitled: true', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: { entitled: true },
      isLoading: false,
    } as any);

    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Create League Button</p>
      </EntitlementGate>,
    );

    expect(screen.getByText('Create League Button')).toBeInTheDocument();
  });

  it('shows upgrade prompt when API returns entitled: false', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        entitled: false,
        reason: 'Limit reached',
        limit: 3,
        currentUsage: 3,
        upgradePlan: 'pro',
      },
      isLoading: false,
    } as any);

    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Create League Button</p>
      </EntitlementGate>,
    );

    expect(screen.queryByText('Create League Button')).not.toBeInTheDocument();
    expect(screen.getByText('Plan Limit Reached')).toBeInTheDocument();
  });

  it('shows usage count when currentUsage and limit are provided', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        entitled: false,
        reason: 'Limit reached',
        currentUsage: 3,
        limit: 3,
        upgradePlan: 'pro',
      },
      isLoading: false,
    } as any);

    render(
      <EntitlementGate entitlementKey="league.create">
        <p>Gated Content</p>
      </EntitlementGate>,
    );

    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument();
  });

  it('renders MVP deferment messaging when upgradePlan is provided', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        entitled: false,
        upgradePlan: 'pro',
      },
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
