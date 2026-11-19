import { Settings } from 'lucide-react';
import { useState } from 'react';
import { Button, PageHeader } from '@/features/shared/ui';
import { useSettingsGroupQuery } from './use-settings-groups';
import { PaymentsDialog } from '@/features/billing/payments-dialog';
import { PlanPricesSection } from '@/features/billing/plan-prices-section';

/**
 * /manage/pricing (#1886): what each plan costs a year and a month and what expanding a contest
 * costs on it, all saved as the payments settings group (BILLING_CONFIG); ⚙ Payments switches
 * payments on or off. Root admin, desktop only. It replaces Settings › Payments.
 */
export function RootAdminPricingPage() {
  const billingQuery = useSettingsGroupQuery('BILLING_CONFIG');
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const billing = billingQuery.data;

  return (
    <section className="space-y-6" data-testid="root-admin-pricing-page">
      <PageHeader
        actions={(
          <Button
            data-testid="root-admin-pricing-payments"
            disabled={!billing}
            onClick={() => setPaymentsOpen(true)}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Settings aria-hidden size={14} />
            Payments
          </Button>
        )}
        meta={billing ? <span data-testid="root-admin-pricing-payments-state">{billing.value.paymentsEnabled ? 'Payments on' : 'Payments off'}</span> : undefined}
        testId="root-admin-pricing-header"
        title="Pricing"
      />
      <PlanPricesSection />
      {paymentsOpen && billing ? <PaymentsDialog group={billing} onClose={() => setPaymentsOpen(false)} /> : null}
    </section>
  );
}
