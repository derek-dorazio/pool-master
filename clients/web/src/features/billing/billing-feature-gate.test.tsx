import { render, screen } from '@testing-library/react';
import { BillingFeatureGate } from './billing-feature-gate';

vi.mock('./hooks/use-billing', () => ({
  useBillingEnabled: vi.fn(),
}));

import { useBillingEnabled } from './hooks/use-billing';

describe('BillingFeatureGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when billing is enabled', () => {
    vi.mocked(useBillingEnabled).mockReturnValue({ data: true } as any);
    render(
      <BillingFeatureGate>
        <p>Billing Content</p>
      </BillingFeatureGate>,
    );
    expect(screen.getByText('Billing Content')).toBeInTheDocument();
  });

  it('shows "Coming Soon" fallback when billing is disabled', () => {
    vi.mocked(useBillingEnabled).mockReturnValue({ data: false } as any);
    render(
      <BillingFeatureGate>
        <p>Billing Content</p>
      </BillingFeatureGate>,
    );
    expect(screen.queryByText('Billing Content')).not.toBeInTheDocument();
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
    expect(screen.getByText(/feature will be available/i)).toBeInTheDocument();
  });

  it('renders custom fallback when provided and billing is disabled', () => {
    vi.mocked(useBillingEnabled).mockReturnValue({ data: false } as any);
    render(
      <BillingFeatureGate fallback={<p>Custom Fallback</p>}>
        <p>Billing Content</p>
      </BillingFeatureGate>,
    );
    expect(screen.queryByText('Billing Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
    expect(screen.getByText('Custom Fallback')).toBeInTheDocument();
  });

  it('shows default fallback when billing data is undefined', () => {
    vi.mocked(useBillingEnabled).mockReturnValue({ data: undefined } as any);
    render(
      <BillingFeatureGate>
        <p>Billing Content</p>
      </BillingFeatureGate>,
    );
    expect(screen.queryByText('Billing Content')).not.toBeInTheDocument();
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
  });
});
